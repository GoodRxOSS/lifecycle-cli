import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decodeJwt, pkcePair } from '../src/lib/auth.js';

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
