import * as p from '@clack/prompts';
import { Command } from 'commander';
import pc from 'picocolors';

import { AuthError, decodeJwt, loginDevice, loginPkce } from '../lib/auth.js';
import {
  configDir,
  DEFAULT_CLIENT_ID,
  DEFAULT_PROFILE_NAME,
  loadConfig,
  saveConfig,
  saveTokens,
  type Profile,
} from '../lib/config.js';
import { link, printJson } from '../lib/output.js';

interface InitOpts {
  apiUrl?: string;
  uiUrl?: string;
  issuer?: string;
  clientId: string;
  auth?: boolean;
  name: string;
  force?: boolean;
  login?: boolean;
  device?: boolean;
  json?: boolean;
}

function validUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return 'must be http(s)';
    return undefined;
  } catch {
    return 'enter a full URL, e.g. https://app.lifecycle.example.com';
  }
}

function cancelled(value: unknown): value is symbol {
  if (p.isCancel(value)) {
    p.cancel('init cancelled — nothing saved');
    process.exitCode = 1;
    return true;
  }
  return false;
}

/** Best-effort reachability check; never blocks setup. */
async function probeApi(apiUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/v2/builds?limit=1`, {
      signal: AbortSignal.timeout(7000),
      redirect: 'manual',
    });
    if (res.status === 401 || res.status === 403) return 'reachable (auth enforced)';
    if (res.ok) return 'reachable';
    return `reachable but returned HTTP ${res.status}`;
  } catch {
    return null;
  }
}

async function runInit(opts: InitOpts): Promise<void> {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const cfg = loadConfig();

  if (cfg.profiles[opts.name] && !opts.force) {
    throw new Error(`Profile "${opts.name}" already exists — re-run with --force to overwrite it`);
  }

  let { apiUrl, uiUrl, issuer } = opts;
  let authEnabled = opts.auth !== false;

  if (interactive && !opts.json) p.intro(pc.bold('lfc init — connect to your Lifecycle deployment'));

  if (!apiUrl) {
    if (!interactive) throw new Error('--api-url is required when not running on a terminal');
    const answer = await p.text({
      message: 'Lifecycle app URL (serves /api/v2)',
      placeholder: 'https://app.lifecycle.example.com',
      validate: v => validUrl(v ?? ''),
    });
    if (cancelled(answer)) return;
    apiUrl = answer as string;
  } else if (validUrl(apiUrl)) {
    throw new Error(`--api-url: ${validUrl(apiUrl)}`);
  }

  if (!uiUrl && interactive) {
    const answer = await p.text({
      message: 'Lifecycle UI URL (optional, used by `lfc builds open`)',
      placeholder: 'https://ui.lifecycle.example.com — enter to skip',
      defaultValue: '',
      validate: v => (v ? validUrl(v) : undefined),
    });
    if (cancelled(answer)) return;
    uiUrl = (answer as string) || undefined;
  }

  // an explicit --issuer implies auth is on; only ask when neither --issuer nor --no-auth was given
  if (opts.auth === undefined && !issuer && interactive) {
    const answer = await p.confirm({ message: 'Does this deployment enforce SSO auth?', initialValue: true });
    if (cancelled(answer)) return;
    authEnabled = answer as boolean;
  }

  if (authEnabled && !issuer) {
    if (!interactive) throw new Error('Auth is enabled but no --issuer given — pass --issuer <url> or use --no-auth');
    const answer = await p.text({
      message: 'Keycloak realm issuer URL',
      placeholder: 'https://auth.lifecycle.example.com/realms/lifecycle',
      validate: v => validUrl(v ?? ''),
    });
    if (cancelled(answer)) return;
    issuer = answer as string;
  }

  const probe = await probeApi(apiUrl);
  if (probe === null) {
    process.stderr.write(`${pc.yellow('!')} Could not reach ${apiUrl} — saving anyway (check the URL or your VPN)\n`);
  } else {
    process.stderr.write(`${pc.green('✓')} ${apiUrl} is ${probe}\n`);
  }

  const profile: Profile = {
    apiUrl: apiUrl.replace(/\/$/, ''),
    ...(uiUrl ? { uiUrl: uiUrl.replace(/\/$/, '') } : {}),
    authEnabled,
    ...(authEnabled ? { keycloak: { issuer: issuer!.replace(/\/$/, ''), clientId: opts.clientId } } : {}),
  };
  cfg.profiles[opts.name] = profile;
  cfg.currentProfile = opts.name;
  saveConfig(cfg);
  process.stderr.write(`${pc.green('✓')} Saved profile "${opts.name}" to ${configDir()}/config.json\n`);

  if (!authEnabled || opts.login === false) {
    if (opts.json) printJson({ profile: opts.name, ...profile, loggedIn: false });
    else if (interactive) p.outro(`You're set — try ${pc.bold('lfc builds list')}`);
    return;
  }

  const kc = profile.keycloak!;
  const tokens = opts.device
    ? await loginDevice(kc, {
        onPrompt: ({ userCode, verificationUri, verificationUriComplete }) => {
          process.stderr.write(
            `\nOn any device, open ${link(verificationUriComplete ?? verificationUri)}\n` +
              `and confirm the code: ${pc.bold(userCode)}\n\nWaiting for approval...\n`,
          );
        },
      })
    : await loginPkce(kc, {
        onAuthUrl: () => {
          process.stderr.write(
            `Opening your browser for SSO login... ${pc.dim('(lfc login --device for headless)')}\n`,
          );
        },
      });
  saveTokens(opts.name, tokens);
  const claims = decodeJwt(tokens.accessToken);
  const who = (claims.email as string) ?? (claims.preferred_username as string) ?? 'unknown';

  if (opts.json) printJson({ profile: opts.name, ...profile, loggedIn: true, user: who });
  else if (interactive) p.outro(`Logged in as ${pc.bold(who)} — try ${pc.bold('lfc builds list')}`);
  else process.stderr.write(`${pc.green('✓')} Logged in as ${pc.bold(who)}\n`);
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('First-time setup: point the CLI at a Lifecycle deployment and log in')
    .option('--api-url <url>', 'Lifecycle app URL (serves /api/v2)')
    .option('--ui-url <url>', 'Lifecycle UI URL (for `lfc builds open`)')
    .option('--issuer <url>', 'Keycloak realm issuer URL')
    .option('--client-id <id>', 'Keycloak public client id', DEFAULT_CLIENT_ID)
    .option('--no-auth', 'this deployment does not enforce auth')
    .option('--name <profile>', 'profile name to create', DEFAULT_PROFILE_NAME)
    .option('--force', 'overwrite the profile if it already exists')
    .option('--no-login', 'set up the profile but skip logging in')
    .option('--device', 'log in with the device-code flow (headless/SSH)')
    .action(async (opts: InitOpts, cmd: Command) => {
      // the program-level --api-url global can swallow the flag, so merge globals in
      const globals = cmd.optsWithGlobals<{ json?: boolean; apiUrl?: string }>();
      try {
        await runInit({
          ...opts,
          apiUrl: opts.apiUrl ?? globals.apiUrl,
          json: Boolean(globals.json) || process.env.LFC_JSON === '1',
        });
      } catch (err) {
        if (err instanceof AuthError) {
          process.stderr.write(`${pc.red('auth error:')} ${err.message}\n`);
          process.exitCode = 4;
        } else {
          process.stderr.write(`${pc.red('error:')} ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      }
    });
}
