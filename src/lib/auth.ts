import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { loadTokens, saveTokens, type KeycloakSettings, type Profile, type TokenSet } from './config.js';

export class AuthError extends Error {}

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  device_authorization_endpoint?: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

// offline_access -> Keycloak issues an offline refresh token governed by the realm's
// Offline Session Idle timeout (30d default, sliding) instead of the SSO session (~12h)
const SCOPES = 'openid profile email offline_access';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
/** refresh when the access token has less than this much life left */
const REFRESH_SKEW_MS = 30_000;

const discoveryCache = new Map<string, OidcDiscovery>();

export async function discover(issuer: string): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new AuthError(`OIDC discovery failed (${res.status}) at ${url}`);
  const doc = (await res.json()) as OidcDiscovery;
  discoveryCache.set(issuer, doc);
  return doc;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new AuthError('Malformed JWT');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

function toTokenSet(t: TokenResponse): TokenSet {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    idToken: t.id_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  };
}

async function postForm(url: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok && !body.error) {
    throw new AuthError(`Token endpoint returned ${res.status}`);
  }
  return body;
}

export function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
  child.on('error', () => {
    /* caller already printed the URL as a fallback */
  });
  child.unref();
}

const SUCCESS_HTML = `<!DOCTYPE html><html><head><title>lfc login</title></head>
<body style="font-family:-apple-system,sans-serif;display:grid;place-items:center;height:90vh">
<div style="text-align:center"><h2>&#10003; Logged in to Lifecycle</h2>
<p>You can close this tab and return to the terminal.</p></div></body></html>`;

/**
 * Authorization Code + PKCE with a localhost loopback redirect.
 * Resolves once the browser hits the local listener and the code is exchanged.
 */
export async function loginPkce(
  kc: KeycloakSettings,
  opts: { noBrowser?: boolean; onAuthUrl: (url: string) => void }
): Promise<TokenSet> {
  const oidc = await discover(kc.issuer);
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(16));

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL(oidc.authorization_endpoint);
  authUrl.searchParams.set('client_id', kc.clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  opts.onAuthUrl(authUrl.toString());
  if (!opts.noBrowser) openBrowser(authUrl.toString());

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new AuthError(`Timed out after ${LOGIN_TIMEOUT_MS / 60_000} minutes waiting for browser login`));
    }, LOGIN_TIMEOUT_MS);

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      const gotState = url.searchParams.get('state');
      const gotCode = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(SUCCESS_HTML);
      clearTimeout(timer);
      server.close();
      if (err) reject(new AuthError(`Login failed: ${err} ${url.searchParams.get('error_description') ?? ''}`));
      else if (gotState !== state) reject(new AuthError('Login failed: state mismatch'));
      else if (!gotCode) reject(new AuthError('Login failed: no authorization code returned'));
      else resolve(gotCode);
    });
  });

  const token = await postForm(oidc.token_endpoint, {
    grant_type: 'authorization_code',
    client_id: kc.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (token.error) throw new AuthError(`Token exchange failed: ${token.error_description ?? token.error}`);
  return toTokenSet(token);
}

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

/**
 * OAuth 2.0 Device Authorization Grant (for headless/SSH machines).
 * Note: this Keycloak client enforces PKCE on the device flow as well,
 * so we send a code_challenge with the device request and the verifier when polling.
 */
export async function loginDevice(
  kc: KeycloakSettings,
  opts: { onPrompt: (info: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void }
): Promise<TokenSet> {
  const oidc = await discover(kc.issuer);
  if (!oidc.device_authorization_endpoint) {
    throw new AuthError('This Keycloak realm does not advertise a device authorization endpoint');
  }
  const { verifier, challenge } = pkcePair();

  const res = await fetch(oidc.device_authorization_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: kc.clientId,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString(),
  });
  const device = (await res.json()) as DeviceAuthResponse;
  if (!res.ok || device.error) {
    throw new AuthError(`Device authorization failed: ${device.error_description ?? device.error ?? res.status}`);
  }

  opts.onPrompt({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    verificationUriComplete: device.verification_uri_complete,
  });

  const deadline = Date.now() + device.expires_in * 1000;
  let intervalMs = (device.interval ?? 5) * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const token = await postForm(oidc.token_endpoint, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: kc.clientId,
      device_code: device.device_code,
      code_verifier: verifier,
    });
    if (token.access_token) return toTokenSet(token);
    if (token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') {
      intervalMs += 5000;
      continue;
    }
    throw new AuthError(`Device login failed: ${token.error_description ?? token.error}`);
  }
  throw new AuthError('Device login expired before it was approved');
}

export async function refreshTokens(kc: KeycloakSettings, tokens: TokenSet): Promise<TokenSet> {
  if (!tokens.refreshToken) throw new AuthError('No refresh token available — run `lfc login`');
  const oidc = await discover(kc.issuer);
  const token = await postForm(oidc.token_endpoint, {
    grant_type: 'refresh_token',
    client_id: kc.clientId,
    refresh_token: tokens.refreshToken,
  });
  if (token.error || !token.access_token) {
    throw new AuthError(`Session expired (${token.error ?? 'no token'}) — run \`lfc login\``);
  }
  return toTokenSet(token);
}

/**
 * Returns a valid access token for the profile, refreshing (and persisting) if needed.
 * Returns null when auth is disabled for the profile.
 */
export async function getAccessToken(
  profileName: string,
  profile: Profile,
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<string | null> {
  if (!profile.authEnabled) return null;
  if (!profile.keycloak) throw new AuthError('Profile has authEnabled but no keycloak settings');
  const tokens = loadTokens(profileName);
  if (!tokens) throw new AuthError('Not logged in — run `lfc login`');
  if (!forceRefresh && tokens.expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return tokens.accessToken;
  }
  const refreshed = await refreshTokens(profile.keycloak, tokens);
  saveTokens(profileName, refreshed);
  return refreshed.accessToken;
}

export async function endSession(kc: KeycloakSettings, tokens: TokenSet): Promise<void> {
  try {
    const oidc = await discover(kc.issuer);
    if (!oidc.end_session_endpoint || !tokens.refreshToken) return;
    await fetch(`${kc.issuer.replace(/\/$/, '')}/protocol/openid-connect/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: kc.clientId, refresh_token: tokens.refreshToken }).toString(),
    });
  } catch {
    // best effort — local tokens are removed regardless
  }
}
