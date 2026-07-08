import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import JsonSchema from 'jsonschema';

import schema100Raw from './schema/lifecycle-1.0.0.json' with { type: 'json' };

// The schema generator annotates the JSON with non-standard `comment` keys that
// the server-side TS schema object doesn't have; with allowUnknownAttributes:false
// the jsonschema validator rejects them as schema errors, so strip them.
function stripComments(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripComments);
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== 'comment')
        .map(([key, value]) => [key, stripComments(value)]),
    );
  }
  return node;
}

const schema100 = stripComments(schema100Raw);

/** Filenames the server looks for in a repo root (LIFECYCLE_FILE_NAME_REGEX = '.?lifecycle.ya?ml'). */
export const CONFIG_FILE_CANDIDATES = ['lifecycle.yaml', 'lifecycle.yml', '.lifecycle.yaml', '.lifecycle.yml'];

export class ConfigFileNotFoundError extends Error {}

export interface SchemaIssue {
  path: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  /** schema version the config was validated against */
  schemaVersion: string;
  /** the `version` declared in the config file, if any */
  declaredVersion?: string;
  errors: SchemaIssue[];
}

// Same custom formats the lifecycle server registers in yamlConfigValidator.ts.
// `schema100Version` is referenced by the schema but has no handler server-side
// either — the jsonschema package skips formats it doesn't know about.
const WEBHOOK_TYPES = ['codefresh', 'docker', 'command'];
const WEBHOOK_STATES = [
  'pending',
  'queued',
  'building',
  'deploying',
  'built',
  'deployed',
  'tearing_down',
  'torn_down',
  'error',
  'config_error',
];
const DISK_ACCESS_MODES = ['readwriteonce', 'readonlymany', 'readwritemany', 'readwriteoncepod'];
const CAPACITY_TYPES = ['on_demand', 'spot'];

JsonSchema.Validator.prototype.customFormats.webhookType = input => WEBHOOK_TYPES.includes(input);
JsonSchema.Validator.prototype.customFormats.webhookState = input =>
  typeof input === 'string' && WEBHOOK_STATES.includes(input.toLowerCase());
JsonSchema.Validator.prototype.customFormats.diskAccessMode = input =>
  typeof input === 'string' && DISK_ACCESS_MODES.includes(input.toLowerCase());
JsonSchema.Validator.prototype.customFormats.capacityType = input =>
  typeof input === 'string' && CAPACITY_TYPES.includes(input.toLowerCase());

/**
 * Resolve the config file to validate.
 * - explicit file path → that file
 * - directory path (or nothing → cwd) → first of CONFIG_FILE_CANDIDATES found inside
 */
export function findConfigFile(input?: string): string {
  const target = input ? path.resolve(input) : process.cwd();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new ConfigFileNotFoundError(`No such file or directory: ${target}`);
  }

  if (stat.isFile()) return target;

  for (const name of CONFIG_FILE_CANDIDATES) {
    const candidate = path.join(target, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new ConfigFileNotFoundError(
    `No lifecycle config found in ${target} (looked for ${CONFIG_FILE_CANDIDATES.join(', ')})`,
  );
}

/** Validate raw YAML content the same way the server does (parse, then schema 1.0.0). */
export function validateConfigContent(content: string): SchemaValidationResult {
  let config: unknown;
  try {
    config = yaml.load(content);
  } catch (err) {
    return {
      valid: false,
      schemaVersion: '1.0.0',
      errors: [{ path: '(yaml)', message: (err as Error).message }],
    };
  }

  if (config === undefined || config === null) {
    return { valid: false, schemaVersion: '1.0.0', errors: [{ path: '(root)', message: 'Config file is empty.' }] };
  }

  const declaredVersion =
    typeof config === 'object' && 'version' in (config as Record<string, unknown>)
      ? String((config as Record<string, unknown>).version)
      : undefined;

  // Mirrors YamlConfigValidator.validate(): every known version routes to 1.0.0.
  const validator = new JsonSchema.Validator();
  const result = validator.validate(config, schema100 as JsonSchema.Schema, {
    allowUnknownAttributes: false,
    nestedErrors: true,
  });

  return {
    valid: result.valid,
    schemaVersion: '1.0.0',
    declaredVersion,
    errors: result.errors.map(e => ({
      path: e.property.replace(/^instance\.?/, '') || '(root)',
      message: e.message,
    })),
  };
}

/** Validate a config file on disk. */
export function validateConfigFile(filePath: string): SchemaValidationResult {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ConfigFileNotFoundError(`Cannot read ${filePath}: ${(err as Error).message}`);
  }
  return validateConfigContent(content);
}
