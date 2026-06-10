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
}

export const DEFAULT_PROFILE_NAME = 'default';

export const DEFAULT_PROFILE: Profile = {
  apiUrl: 'https://app.lifecycle.lfc.goodrx.com',
  uiUrl: 'https://ui.lifecycle.lfc.goodrx.com',
  authEnabled: true,
  keycloak: {
    issuer: 'https://auth.lifecycle.lfc.goodrx.com/realms/lifecycle',
    clientId: 'lifecycle-cli',
  },
};

export function configDir(): string {
  return process.env.LFC_CONFIG_DIR || path.join(os.homedir(), '.config', 'lifecycle-cli');
}

function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export function loadConfig(): ConfigFile {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as ConfigFile;
    if (!parsed.profiles || typeof parsed.profiles !== 'object') throw new Error('malformed');
    if (!parsed.currentProfile || !parsed.profiles[parsed.currentProfile]) {
      parsed.currentProfile = Object.keys(parsed.profiles)[0] ?? DEFAULT_PROFILE_NAME;
    }
    if (!parsed.profiles[DEFAULT_PROFILE_NAME] && Object.keys(parsed.profiles).length === 0) {
      parsed.profiles[DEFAULT_PROFILE_NAME] = { ...DEFAULT_PROFILE };
    }
    return parsed;
  } catch {
    return {
      currentProfile: DEFAULT_PROFILE_NAME,
      profiles: { [DEFAULT_PROFILE_NAME]: { ...DEFAULT_PROFILE } },
    };
  }
}

export function saveConfig(config: ConfigFile): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function resolveProfile(config: ConfigFile, name?: string): { name: string; profile: Profile } {
  const profileName = name || process.env.LFC_PROFILE || config.currentProfile;
  const profile = config.profiles[profileName];
  if (!profile) {
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

function tokensDir(): string {
  return path.join(configDir(), 'tokens');
}

function tokensPath(profileName: string): string {
  return path.join(tokensDir(), `${profileName}.json`);
}

export function loadTokens(profileName: string): TokenSet | null {
  try {
    return JSON.parse(fs.readFileSync(tokensPath(profileName), 'utf8')) as TokenSet;
  } catch {
    return null;
  }
}

export function saveTokens(profileName: string, tokens: TokenSet): void {
  fs.mkdirSync(tokensDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokensPath(profileName), `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
}

export function clearTokens(profileName: string): boolean {
  try {
    fs.unlinkSync(tokensPath(profileName));
    return true;
  } catch {
    return false;
  }
}
