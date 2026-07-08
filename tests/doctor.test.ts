import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configDir, configPath, saveConfig, saveTokens, tokensDir, tokensPath } from '../src/lib/config.js';
import { runDoctor } from '../src/lib/doctor.js';

let dir: string;

function fakeJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'sig',
  ].join('.');
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfc-doctor-'));
  process.env.LFC_CONFIG_DIR = dir;
  delete process.env.LFC_PROFILE;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.LFC_CONFIG_DIR;
});

describe('runDoctor', () => {
  it('reports missing setup without throwing', () => {
    const report = runDoctor();

    expect(report.ok).toBe(false);
    expect(report.checks.some(check => check.id === 'config_profile' && check.status === 'warn')).toBe(true);
  });

  it('repairs loose config and token permissions with fix=true', () => {
    saveConfig({
      currentProfile: 'default',
      profiles: {
        default: {
          apiUrl: 'https://lc.example.com',
          authEnabled: true,
          keycloak: { issuer: 'https://auth.example.com/realms/lifecycle', clientId: 'lifecycle-cli' },
        },
      },
    });
    saveTokens('default', {
      accessToken: fakeJwt({ email: 'user@example.com' }),
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60_000,
    });

    fs.chmodSync(configDir(), 0o755);
    fs.chmodSync(configPath(), 0o644);
    fs.chmodSync(tokensDir(), 0o755);
    fs.chmodSync(tokensPath('default'), 0o644);

    const before = runDoctor();
    expect(before.checks.some(check => check.fixable && check.status === 'warn')).toBe(true);

    const after = runDoctor({ fix: true });
    expect(after.checks.filter(check => check.fixed).length).toBeGreaterThanOrEqual(4);
    expect(fs.statSync(configDir()).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(fs.statSync(tokensDir()).mode & 0o777).toBe(0o700);
    expect(fs.statSync(tokensPath('default')).mode & 0o777).toBe(0o600);
  });
});
