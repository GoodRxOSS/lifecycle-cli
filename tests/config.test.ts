import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearTokens,
  loadConfig,
  loadTokens,
  resolveProfile,
  saveConfig,
  saveTokens,
} from '../src/lib/config.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfc-test-'));
  process.env.LFC_CONFIG_DIR = dir;
  delete process.env.LFC_PROFILE;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.LFC_CONFIG_DIR;
});

describe('config', () => {
  it('returns the default prod profile when no config exists', () => {
    const cfg = loadConfig();
    expect(cfg.currentProfile).toBe('default');
    expect(cfg.profiles.default!.apiUrl).toBe('https://app.lifecycle.lfc.goodrx.com');
    expect(cfg.profiles.default!.authEnabled).toBe(true);
    expect(cfg.profiles.default!.keycloak!.clientId).toBe('lifecycle-cli');
  });

  it('round-trips config edits', () => {
    const cfg = loadConfig();
    cfg.profiles.staging = { apiUrl: 'https://staging.example.com', authEnabled: false };
    cfg.currentProfile = 'staging';
    saveConfig(cfg);
    const again = loadConfig();
    expect(again.currentProfile).toBe('staging');
    expect(again.profiles.staging!.authEnabled).toBe(false);
  });

  it('resolves profiles with override and errors on unknown', () => {
    const cfg = loadConfig();
    expect(resolveProfile(cfg).name).toBe('default');
    expect(() => resolveProfile(cfg, 'nope')).toThrow(/Unknown profile/);
  });

  it('stores tokens with owner-only permissions and clears them', () => {
    saveTokens('default', { accessToken: 'a', refreshToken: 'r', expiresAt: 123 });
    const tokens = loadTokens('default');
    expect(tokens?.accessToken).toBe('a');
    const mode = fs.statSync(path.join(dir, 'tokens', 'default.json')).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(clearTokens('default')).toBe(true);
    expect(loadTokens('default')).toBeNull();
  });
});
