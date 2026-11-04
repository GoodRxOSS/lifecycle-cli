import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { apiKeyFromEnv, AuthError, decodeJwt, getAccessToken, pkcePair } from '../src/lib/auth.js';
import { saveTokens } from '../src/lib/config.js';

describe('pkcePair', () => {
  it('generates an S256 challenge for the verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('generates unique verifiers', () => {
    expect(pkcePair().verifier).not.toBe(pkcePair().verifier);
  });
});

describe('decodeJwt', () => {
  it('decodes the payload without verifying', () => {
    const payload = Buffer.from(JSON.stringify({ email: 'a@b.c', exp: 1 })).toString('base64url');
    const token = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
    expect(decodeJwt(token)).toEqual({ email: 'a@b.c', exp: 1 });
  });

  it('throws on malformed tokens', () => {
    expect(() => decodeJwt('garbage')).toThrow();
  });
});

describe('LFC_API_KEY', () => {
  const key = `lfc_svc_${'a'.repeat(40)}`;
  const profile = { apiUrl: 'https://lfc.example', authEnabled: false } as const;

  beforeEach(() => {
    delete process.env.LFC_API_KEY;
  });

  afterEach(() => {
    delete process.env.LFC_API_KEY;
  });

  it('takes precedence over cached SSO tokens', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfc-auth-'));
    process.env.LFC_CONFIG_DIR = dir;
    try {
      saveTokens('default', { accessToken: 'sso-token', expiresAt: Date.now() + 3_600_000 });
      const sso = { ...profile, authEnabled: true, keycloak: { issuer: 'https://kc.example', clientId: 'cli' } };
      await expect(getAccessToken('default', sso)).resolves.toBe('sso-token');

      process.env.LFC_API_KEY = key;
      await expect(getAccessToken('default', sso)).resolves.toBe(key);
    } finally {
      delete process.env.LFC_CONFIG_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a set-but-empty key instead of silently going unauthenticated', () => {
    process.env.LFC_API_KEY = '   ';
    expect(() => apiKeyFromEnv()).toThrow(AuthError);
  });

  it('is returned as the access token without a profile login', async () => {
    process.env.LFC_API_KEY = ` ${key}\n`;
    expect(apiKeyFromEnv()).toBe(key);
    await expect(getAccessToken('nope', { ...profile })).resolves.toBe(key);
  });

  it('is absent when unset', () => {
    expect(apiKeyFromEnv()).toBeNull();
  });

  it('rejects a malformed key', () => {
    process.env.LFC_API_KEY = 'not-a-key';
    expect(() => apiKeyFromEnv()).toThrow(AuthError);
  });
});
