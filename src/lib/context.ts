import type { Command } from 'commander';
import pc from 'picocolors';

import { ApiClient, ApiError } from './api.js';
import { AuthError } from './auth.js';
import { loadConfig, resolveProfile, type ConfigFile, type Profile } from './config.js';
import { reportInvocation, type TelemetryOutcome } from './telemetry.js';

export interface Ctx {
  config: ConfigFile;
  profileName: string;
  profile: Profile;
  json: boolean;
  quiet: boolean;
  api: ApiClient;
  uiUrl?: string;
  cmd: Command;
}

export function buildCtx(cmd: Command): Ctx {
  const opts = cmd.optsWithGlobals<{ json?: boolean; profile?: string; apiUrl?: string; quiet?: boolean }>();
  const config = loadConfig();
  const apiUrlOverride = opts.apiUrl || process.env.LIFECYCLE_API_URL;
  const { name, profile } = resolveProfile(config, opts.profile, apiUrlOverride);
  return {
    config,
    profileName: name,
    profile,
    json: Boolean(opts.json) || process.env.LFC_JSON === '1',
    quiet: Boolean(opts.quiet),
    api: new ApiClient(name, profile, opts.apiUrl),
    uiUrl: profile.uiUrl?.replace(/\/$/, ''),
    cmd,
  };
}

/** Wrap a command action: build ctx, run, and convert known errors into friendly exits. */
export function runAction<A extends unknown[]>(
  fn: (ctx: Ctx, ...args: A) => Promise<void>,
): (...args: [...A, Command]) => Promise<void> {
  return async (...args) => {
    const cmd = args[args.length - 1] as Command;
    const rest = args.slice(0, -1) as unknown as A;
    let ctx: Ctx | undefined;
    const startedAt = Date.now();
    let outcome: TelemetryOutcome = { status: 'success', exitCode: 0 };
    try {
      ctx = buildCtx(cmd);
      await fn(ctx, ...rest);
    } catch (err) {
      if (err instanceof AuthError) {
        process.stderr.write(`${pc.red('auth error:')} ${err.message}\n`);
        process.exitCode = 4;
        outcome = { status: 'error', exitCode: 4, errorClass: 'AuthError' };
      } else if (err instanceof ApiError) {
        const reqId = err.requestId ? pc.dim(` (request_id: ${err.requestId})`) : '';
        process.stderr.write(`${pc.red(`api error (${err.status}):`)} ${err.message}${reqId}\n`);
        const exitCode = err.status === 404 ? 3 : 1;
        process.exitCode = exitCode;
        outcome = {
          status: 'error',
          exitCode,
          errorClass: 'ApiError',
          errorHttpStatus: err.status,
          errorCode: err.code,
        };
      } else {
        process.stderr.write(`${pc.red('error:')} ${(err as Error).message}\n`);
        process.exitCode = 1;
        outcome = { status: 'error', exitCode: 1, errorClass: 'Error' };
      }
    }
    // Some commands signal failure by setting process.exitCode and returning rather than
    // throwing (e.g. a terminally-failed build, invalid schema); reflect that in telemetry.
    if (outcome.status === 'success' && process.exitCode) {
      outcome = { status: 'error', exitCode: Number(process.exitCode) };
    }
    await reportInvocation(ctx, cmd, Date.now() - startedAt, outcome);
  };
}
