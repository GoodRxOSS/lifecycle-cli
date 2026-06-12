import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearTokens,
  configDir,
  configPath,
  loadConfig,
  loadTokens,
  resolveProfile,
  saveConfig,
  saveTokens,
  tokensDir,
  tokensPath,
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
  it('ships with no profiles — no deployment URLs baked in', () => {
    const cfg = loadConfig();
    expect(cfg.currentProfile).toBe('default');
    expect(cfg.profiles).toEqual({});
  });

  it('tells the user to run lfc init when unconfigured', () => {
    expect(() => resolveProfile(loadConfig())).toThrow(/lfc init/);
  });

  it('allows an ad-hoc apiUrl override with no config (auth-less)', () => {
    const { profile } = resolveProfile(loadConfig(), undefined, 'https://lc.example.com');
    expect(profile.apiUrl).toBe('https://lc.example.com');
    expect(profile.authEnabled).toBe(false);
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

  it('repairs config directory and file permissions when saving', () => {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o755 });
    fs.writeFileSync(configPath(), '{}\n', { mode: 0o644 });
    fs.chmodSync(configDir(), 0o755);
    fs.chmodSync(configPath(), 0o644);

    saveConfig({ currentProfile: 'default', profiles: { default: { apiUrl: 'https://lc.example.com', authEnabled: false } } });

    expect(fs.statSync(configDir()).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600);
  });

  it('resolves profiles with override and errors on unknown', () => {
    const cfg = loadConfig();
    cfg.profiles.default = { apiUrl: 'https://lc.example.com', authEnabled: false };
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

  it('repairs token directory and file permissions when saving', () => {
    fs.mkdirSync(tokensDir(), { recursive: true, mode: 0o755 });
    fs.writeFileSync(tokensPath('default'), '{}\n', { mode: 0o644 });
    fs.chmodSync(tokensDir(), 0o755);
    fs.chmodSync(tokensPath('default'), 0o644);

    saveTokens('default', { accessToken: 'a', refreshToken: 'r', expiresAt: 123 });

    expect(fs.statSync(configDir()).mode & 0o777).toBe(0o700);
    expect(fs.statSync(tokensDir()).mode & 0o777).toBe(0o700);
    expect(fs.statSync(tokensPath('default')).mode & 0o777).toBe(0o600);
  });
});
