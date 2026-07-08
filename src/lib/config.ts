import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface KeycloakSettings {
  issuer: string;
  clientId: string;
}

export interface Profile {
  apiUrl: string;
  uiUrl?: string;
  authEnabled: boolean;
  keycloak?: KeycloakSettings;
}

export interface ConfigFile {
  currentProfile: string;
  profiles: Record<string, Profile>;
  /** Anonymous telemetry install id — a random UUID, never tied to a user. */
  installId?: string;
}

export const DEFAULT_PROFILE_NAME = 'default';
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** Conventional Keycloak client id for Lifecycle deployments; overridable per profile. */
export const DEFAULT_CLIENT_ID = 'lifecycle-cli';

export function configDir(): string {
  return process.env.LFC_CONFIG_DIR || path.join(os.homedir(), '.config', 'lifecycle-cli');
}

export function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export function tokensDir(): string {
  return path.join(configDir(), 'tokens');
}

export function tokensPath(profileName: string): string {
  return path.join(tokensDir(), `${profileName}.json`);
}

export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  fs.chmodSync(dir, PRIVATE_DIR_MODE);
}

export function writePrivateJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
  fs.chmodSync(filePath, PRIVATE_FILE_MODE);
}

export function loadConfig(): ConfigFile {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as ConfigFile;
    if (!parsed.profiles || typeof parsed.profiles !== 'object') throw new Error('malformed');
    if (!parsed.currentProfile || !parsed.profiles[parsed.currentProfile]) {
      parsed.currentProfile = Object.keys(parsed.profiles)[0] ?? DEFAULT_PROFILE_NAME;
    }
    return parsed;
  } catch {
    // The CLI ships with no deployment URLs baked in — an empty config until `lfc init`.
    return { currentProfile: DEFAULT_PROFILE_NAME, profiles: {} };
  }
}

export function saveConfig(config: ConfigFile): void {
  ensurePrivateDir(configDir());
  writePrivateJson(configPath(), config);
}

export function resolveProfile(
  config: ConfigFile,
  name?: string,
  apiUrlOverride?: string,
): { name: string; profile: Profile } {
  const profileName = name || process.env.LFC_PROFILE || config.currentProfile;
  const profile = config.profiles[profileName];
  if (!profile) {
    if (Object.keys(config.profiles).length === 0) {
      // No config yet — an explicit --api-url / LIFECYCLE_API_URL still works (auth-less, ad hoc).
      if (apiUrlOverride) {
        return { name: profileName, profile: { apiUrl: apiUrlOverride, authEnabled: false } };
      }
      throw new Error('No configuration found. Run `lfc init` to point the CLI at your Lifecycle deployment.');
    }
    const available = Object.keys(config.profiles).join(', ');
    throw new Error(`Unknown profile "${profileName}" (available: ${available})`);
  }
  return { name: profileName, profile };
}

// --- token storage ---

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
}

export function loadTokens(profileName: string): TokenSet | null {
  try {
    return JSON.parse(fs.readFileSync(tokensPath(profileName), 'utf8')) as TokenSet;
  } catch {
    return null;
  }
}

export function saveTokens(profileName: string, tokens: TokenSet): void {
  ensurePrivateDir(configDir());
  ensurePrivateDir(tokensDir());
  writePrivateJson(tokensPath(profileName), tokens);
}

export function clearTokens(profileName: string): boolean {
  try {
    fs.unlinkSync(tokensPath(profileName));
    return true;
  } catch {
    return false;
  }
}
