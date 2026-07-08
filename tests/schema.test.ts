import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigFileNotFoundError, findConfigFile, validateConfigContent } from '../src/lib/schema.js';

const VALID = `
version: "1.0.0"
environment:
  defaultServices:
    - name: web
  optionalServices:
    - name: worker
services:
  - name: web
    appShort: "web"
    defaultUUID: "dev-0"
    github:
      repository: acme/storefront
      branchName: main
      docker:
        defaultTag: main
        app:
          dockerfilePath: Dockerfile
          ports:
            - 8080
  - name: worker
    appShort: "wrk"
    defaultUUID: "dev-0"
    github:
      repository: acme/storefront
      branchName: main
      docker:
        defaultTag: main
        app:
          dockerfilePath: worker.Dockerfile
`;

describe('validateConfigContent', () => {
  it('accepts a valid 1.0.0 config', () => {
    const result = validateConfigContent(VALID);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.declaredVersion).toBe('1.0.0');
    expect(result.schemaVersion).toBe('1.0.0');
  });

  it('rejects unknown top-level properties (additionalProperties: false)', () => {
    const result = validateConfigContent(`${VALID}\nbogusKey: true\n`);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('bogusKey'))).toBe(true);
  });

  it('reports the property path for nested type errors', () => {
    const bad = VALID.replace('branchName: main', 'branchName: [oops]');
    const result = validateConfigContent(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path.includes('services[0].github.branchName'))).toBe(true);
  });

  it('validates custom formats like webhook type', () => {
    const withWebhook = VALID.replace(
      'environment:',
      `environment:
  webhooks:
    - name: notify
      type: carrier-pigeon
      state: deployed
      env: {}`,
    );
    const result = validateConfigContent(withWebhook);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path.includes('webhooks[0].type'))).toBe(true);
  });

  it('flags empty files', () => {
    const result = validateConfigContent('');
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toBe('Config file is empty.');
  });

  it('reports YAML syntax errors', () => {
    const result = validateConfigContent('services:\n  - name: web\n   bad indent: [');
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe('(yaml)');
  });
});

describe('findConfigFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfc-schema-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prefers lifecycle.yaml over dotfile variants', () => {
    fs.writeFileSync(path.join(dir, '.lifecycle.yml'), 'a: 1');
    fs.writeFileSync(path.join(dir, 'lifecycle.yaml'), 'a: 1');
    expect(findConfigFile(dir)).toBe(path.join(dir, 'lifecycle.yaml'));
  });

  it('finds dotfile variants', () => {
    fs.writeFileSync(path.join(dir, '.lifecycle.yaml'), 'a: 1');
    expect(findConfigFile(dir)).toBe(path.join(dir, '.lifecycle.yaml'));
  });

  it('accepts an explicit file path of any name', () => {
    const file = path.join(dir, 'whatever.yaml');
    fs.writeFileSync(file, 'a: 1');
    expect(findConfigFile(file)).toBe(file);
  });

  it('throws ConfigFileNotFoundError when nothing matches', () => {
    expect(() => findConfigFile(dir)).toThrow(ConfigFileNotFoundError);
    expect(() => findConfigFile(path.join(dir, 'nope.yaml'))).toThrow(ConfigFileNotFoundError);
  });
});
