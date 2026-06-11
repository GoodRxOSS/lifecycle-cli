import fs from 'node:fs';
import path from 'node:path';

import { decodeJwt } from './auth.js';
import {
  configDir,
  configPath,
  loadConfig,
  loadTokens,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  tokensDir,
  tokensPath,
} from './config.js';

export type DoctorStatus = 'ok' | 'warn' | 'error';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  path?: string;
  expectedMode?: string;
  actualMode?: string;
  fixable?: boolean;
  fixed?: boolean;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

function modeString(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`;
}

function readMode(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mode & 0o777;
  } catch {
    return null;
  }
}

function permissionCheck(args: {
  id: string;
  label: string;
  path: string;
  expectedMode: number;
  fix?: boolean;
}): DoctorCheck {
  const actual = readMode(args.path);
  const expectedMode = modeString(args.expectedMode);

  if (actual === null) {
    return {
      id: args.id,
      label: args.label,
      status: 'warn',
      message: `${args.path} does not exist`,
      path: args.path,
      expectedMode,
      fixable: false,
    };
  }

  if (actual === args.expectedMode) {
    return {
      id: args.id,
      label: args.label,
      status: 'ok',
      message: `${args.path} has mode ${expectedMode}`,
      path: args.path,
      expectedMode,
      actualMode: modeString(actual),
    };
  }

  if (args.fix) {
    try {
      fs.chmodSync(args.path, args.expectedMode);
      return {
        id: args.id,
        label: args.label,
        status: 'ok',
        message: `${args.path} mode repaired to ${expectedMode}`,
        path: args.path,
        expectedMode,
        actualMode: modeString(actual),
        fixable: true,
        fixed: true,
      };
    } catch (err) {
      return {
        id: args.id,
        label: args.label,
        status: 'error',
        message: `failed to repair ${args.path}: ${(err as Error).message}`,
        path: args.path,
        expectedMode,
        actualMode: modeString(actual),
        fixable: true,
      };
    }
  }

  return {
    id: args.id,
    label: args.label,
    status: 'warn',
    message: `${args.path} is ${modeString(actual)}, expected ${expectedMode}`,
    path: args.path,
    expectedMode,
    actualMode: modeString(actual),
    fixable: true,
  };
}

function nodeVersionCheck(): DoctorCheck {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= 20;
  return {
    id: 'node_version',
    label: 'node',
    status: ok ? 'ok' : 'error',
    message: ok ? `node ${process.version}` : `node ${process.version}; expected >=20`,
  };
}

function configChecks(): DoctorCheck[] {
  const config = loadConfig();
  const checks: DoctorCheck[] = [];

  if (Object.keys(config.profiles).length === 0) {
    checks.push({
      id: 'config_profile',
      label: 'profile',
      status: 'warn',
      message: 'no profiles configured; run `lfc init`',
    });
    return checks;
  }

  const active = config.profiles[config.currentProfile];
  if (!active) {
    checks.push({
      id: 'config_profile',
      label: 'profile',
      status: 'error',
      message: `active profile "${config.currentProfile}" is missing`,
    });
    return checks;
  }

  if (!active.apiUrl) {
    checks.push({
      id: 'config_api_url',
      label: 'api url',
      status: 'error',
      message: `profile "${config.currentProfile}" is missing apiUrl`,
    });
  } else {
    checks.push({
      id: 'config_api_url',
      label: 'api url',
      status: 'ok',
      message: active.apiUrl,
    });
  }

  if (active.authEnabled && (!active.keycloak?.issuer || !active.keycloak.clientId)) {
    checks.push({
      id: 'config_auth',
      label: 'auth',
      status: 'error',
      message: `profile "${config.currentProfile}" has auth enabled but incomplete Keycloak settings`,
    });
  } else {
    checks.push({
      id: 'config_auth',
      label: 'auth',
      status: 'ok',
      message: active.authEnabled ? `sso via ${active.keycloak!.issuer}` : 'disabled',
    });
  }

  if (active.authEnabled) {
    const tokens = loadTokens(config.currentProfile);
    if (!tokens) {
      checks.push({
        id: 'token_presence',
        label: 'token',
        status: 'warn',
        message: `no token cached for profile "${config.currentProfile}"; run \`lfc login\``,
      });
    } else {
      let who = 'unknown user';
      let decoded = true;
      const expired = tokens.expiresAt <= Date.now();
      try {
        const claims = decodeJwt(tokens.accessToken);
        who = String(claims.email ?? claims.preferred_username ?? who);
      } catch {
        decoded = false;
        checks.push({
          id: 'token_decode',
          label: 'token',
          status: 'warn',
          message: 'cached access token could not be decoded; run `lfc login`',
        });
      }
      checks.push({
        id: 'token_presence',
        label: 'token',
        status: decoded && !expired ? 'ok' : 'warn',
        message: `${who}; access token ${
          expired ? 'expired' : 'expires'
        } ${new Date(tokens.expiresAt).toISOString()}; refresh token ${tokens.refreshToken ? 'present' : 'missing'}`,
      });
    }
  }

  return checks;
}

export function runDoctor({ fix = false }: { fix?: boolean } = {}): DoctorReport {
  const checks: DoctorCheck[] = [
    nodeVersionCheck(),
    permissionCheck({
      id: 'config_dir_permissions',
      label: 'config dir',
      path: configDir(),
      expectedMode: PRIVATE_DIR_MODE,
      fix,
    }),
    permissionCheck({
      id: 'config_file_permissions',
      label: 'config file',
      path: configPath(),
      expectedMode: PRIVATE_FILE_MODE,
      fix,
    }),
    permissionCheck({
      id: 'tokens_dir_permissions',
      label: 'tokens dir',
      path: tokensDir(),
      expectedMode: PRIVATE_DIR_MODE,
      fix,
    }),
    ...configChecks(),
  ];

  if (fs.existsSync(tokensDir())) {
    for (const entry of fs.readdirSync(tokensDir())) {
      if (!entry.endsWith('.json')) continue;
      checks.push(
        permissionCheck({
          id: 'token_file_permissions',
          label: `token ${entry}`,
          path: path.join(tokensDir(), entry),
          expectedMode: PRIVATE_FILE_MODE,
          fix,
        })
      );
    }
  }

  return {
    ok: checks.every((check) => check.status === 'ok'),
    checks,
  };
}
