import crypto from 'node:crypto';

import type { Command } from 'commander';

import { loadConfig, loadTokens, saveConfig } from './config.js';
import type { Ctx } from './context.js';
import type { CreateTelemetryEventBody } from './generated/index.js';

import pkg from '../../package.json' with { type: 'json' };

export const TELEMETRY_TIMEOUT_MS = 3000;

export interface TelemetryOutcome {
  status: 'success' | 'error';
  exitCode: number;
  errorClass?: string;
  errorHttpStatus?: number;
  errorCode?: string;
}

export function isTelemetryDisabled(value = process.env.LFC_TELEMETRY_DISABLED): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

/** Full subcommand path (e.g. "builds env set"), excluding the root program name. */
export function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c && c.parent; c = c.parent) names.unshift(c.name());
  return names.join(' ');
}

/** Long names of options explicitly passed on the command line, across the command chain. Values are never collected. */
export function explicitFlags(cmd: Command): string[] {
  const flags = new Set<string>();
  for (let c: Command | null = cmd; c; c = c.parent) {
    for (const opt of c.options) {
      if (c.getOptionValueSource(opt.attributeName()) === 'cli') {
        flags.add(opt.long ?? opt.short ?? opt.name());
      }
    }
  }
  return [...flags];
}

/** Anonymous per-install id, created on first use and persisted in the CLI config. */
export function getInstallId(): string {
  const config = loadConfig();
  if (config.installId) return config.installId;
  const installId = crypto.randomUUID();
  try {
    saveConfig({ ...config, installId });
  } catch {
    // unwritable config dir — report with an ephemeral id rather than fail
  }
  return installId;
}

/**
 * An already-valid access token for the profile, or null. Reads only the cached token —
 * never triggers a Keycloak refresh, so the telemetry send stays a single network op
 * bounded by TELEMETRY_TIMEOUT_MS.
 */
function cachedAccessToken(ctx: Ctx): string | null {
  const tokens = loadTokens(ctx.profileName);
  if (!tokens) return null;
  return tokens.expiresAt > Date.now() ? tokens.accessToken : null;
}

/**
 * Report one command invocation to the deployment's telemetry endpoint.
 * Must never affect the command: every failure (offline, logged out, old server
 * without the endpoint, timeout) is swallowed, bounded by TELEMETRY_TIMEOUT_MS.
 */
export async function reportInvocation(
  ctx: Ctx | undefined,
  cmd: Command,
  durationMs: number,
  outcome: TelemetryOutcome
): Promise<void> {
  if (isTelemetryDisabled() || !ctx) return;

  // On auth-required deployments, only report when a valid token is already cached.
  // Refreshing here could hit Keycloak with no timeout, escaping the fetch bound below.
  let token: string | null = null;
  if (ctx.profile.authEnabled) {
    token = cachedAccessToken(ctx);
    if (!token) return;
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const body: CreateTelemetryEventBody = {
      source: 'cli',
      clientId: getInstallId(),
      event: commandPath(cmd),
      attributes: { flags: explicitFlags(cmd) },
      durationMs: Math.round(durationMs),
      status: outcome.status,
      exitCode: outcome.exitCode,
      errorClass: outcome.errorClass ?? null,
      errorHttpStatus: outcome.errorHttpStatus ?? null,
      errorCode: outcome.errorCode ?? null,
      clientVersion: pkg.version,
      runtimeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    };
    await fetch(`${ctx.api.baseUrl}/api/v2/telemetry/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS),
    });
  } catch {
    // telemetry is strictly best-effort
  }
}
