import type { Command } from 'commander';
import pc from 'picocolors';

import { ApiClient, ApiError } from './api.js';
import { AuthError } from './auth.js';
import { loadConfig, resolveProfile, type ConfigFile, type Profile } from './config.js';

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
  const { name, profile } = resolveProfile(config, opts.profile);
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
  fn: (ctx: Ctx, ...args: A) => Promise<void>
): (...args: [...A, Command]) => Promise<void> {
  return async (...args) => {
    const cmd = args[args.length - 1] as Command;
    const rest = args.slice(0, -1) as unknown as A;
    try {
      const ctx = buildCtx(cmd);
      await fn(ctx, ...rest);
    } catch (err) {
      if (err instanceof AuthError) {
        process.stderr.write(`${pc.red('auth error:')} ${err.message}\n`);
        process.exitCode = 4;
      } else if (err instanceof ApiError) {
        const reqId = err.requestId ? pc.dim(` (request_id: ${err.requestId})`) : '';
        process.stderr.write(`${pc.red(`api error (${err.status}):`)} ${err.message}${reqId}\n`);
        process.exitCode = err.status === 404 ? 3 : 1;
      } else {
        process.stderr.write(`${pc.red('error:')} ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    }
  };
}
