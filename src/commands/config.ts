import { Command } from 'commander';
import pc from 'picocolors';

import { DEFAULT_PROFILE, loadConfig, saveConfig, type Profile } from '../lib/config.js';
import { runAction } from '../lib/context.js';
import { printJson, renderTable } from '../lib/output.js';

const SETTABLE_KEYS = ['apiUrl', 'uiUrl', 'authEnabled', 'keycloak.issuer', 'keycloak.clientId'] as const;

function setKey(profile: Profile, key: string, value: string): void {
  switch (key) {
    case 'apiUrl':
      profile.apiUrl = value;
      break;
    case 'uiUrl':
      profile.uiUrl = value;
      break;
    case 'authEnabled':
      profile.authEnabled = value === 'true';
      break;
    case 'keycloak.issuer':
      profile.keycloak = { clientId: 'lifecycle-cli', ...profile.keycloak, issuer: value };
      break;
    case 'keycloak.clientId':
      profile.keycloak = { issuer: '', ...profile.keycloak, clientId: value };
      break;
    default:
      throw new Error(`Unknown key "${key}" (settable: ${SETTABLE_KEYS.join(', ')})`);
  }
}

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('Manage profiles and CLI configuration');

  config
    .command('list')
    .description('List profiles and their settings')
    .action(
      runAction(async (ctx) => {
        if (ctx.json) {
          printJson({ currentProfile: ctx.config.currentProfile, profiles: ctx.config.profiles });
          return;
        }
        const rows = Object.entries(ctx.config.profiles).map(([name, p]) => [
          name === ctx.config.currentProfile ? `${pc.green('●')} ${name}` : `  ${name}`,
          p.apiUrl,
          p.authEnabled ? 'sso' : 'disabled',
          p.keycloak?.issuer ?? '',
        ]);
        process.stdout.write(renderTable(['profile', 'api url', 'auth', 'issuer'], rows) + '\n');
      })
    );

  config
    .command('get [key]')
    .description('Show the active profile (or one key, e.g. apiUrl)')
    .action(
      runAction(async (ctx, key?: string) => {
        const profile = ctx.profile as unknown as Record<string, unknown>;
        if (!key) {
          printJson({ profile: ctx.profileName, ...ctx.profile });
          return;
        }
        const value = key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], profile);
        if (ctx.json) printJson({ [key]: value ?? null });
        else process.stdout.write(`${String(value ?? '')}\n`);
      })
    );

  config
    .command('set <key> <value>')
    .description(`Set a value on the active profile (${SETTABLE_KEYS.join(', ')})`)
    .action(
      runAction(async (ctx, key: string, value: string) => {
        const cfg = loadConfig();
        const profile = cfg.profiles[ctx.profileName];
        if (!profile) throw new Error(`Profile "${ctx.profileName}" not found`);
        setKey(profile, key, value);
        saveConfig(cfg);
        process.stderr.write(`${pc.green('✓')} ${ctx.profileName}.${key} = ${value}\n`);
      })
    );

  config
    .command('add-profile <name>')
    .description('Create a new profile (defaults copied from the built-in prod profile)')
    .option('--api-url <url>', 'Lifecycle API base URL')
    .option('--no-auth', 'disable SSO auth for this profile (for auth-less deployments)')
    .action(
      runAction(async (ctx, name: string, opts: { apiUrl?: string; auth?: boolean }) => {
        const cfg = loadConfig();
        if (cfg.profiles[name]) throw new Error(`Profile "${name}" already exists`);
        cfg.profiles[name] = {
          ...DEFAULT_PROFILE,
          ...(opts.apiUrl ? { apiUrl: opts.apiUrl } : {}),
          authEnabled: opts.auth !== false,
        };
        saveConfig(cfg);
        process.stderr.write(`${pc.green('✓')} Created profile "${name}" — switch with \`lfc config use-profile ${name}\`\n`);
      })
    );

  config
    .command('use-profile <name>')
    .description('Switch the active profile')
    .action(
      runAction(async (_ctx, name: string) => {
        const cfg = loadConfig();
        if (!cfg.profiles[name]) throw new Error(`Profile "${name}" not found`);
        cfg.currentProfile = name;
        saveConfig(cfg);
        process.stderr.write(`${pc.green('✓')} Active profile: ${name}\n`);
      })
    );
}
