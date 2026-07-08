import * as clack from '@clack/prompts';
import { Command } from 'commander';
import pc from 'picocolors';

import { AuthError, decodeJwt, endSession, loginDevice, loginPkce } from '../lib/auth.js';
import { clearTokens, loadTokens, saveTokens } from '../lib/config.js';
import { runAction, type Ctx } from '../lib/context.js';
import { link, printJson } from '../lib/output.js';

function requireKeycloak(ctx: Ctx) {
  if (!ctx.profile.authEnabled || !ctx.profile.keycloak) {
    throw new AuthError(
      `Profile "${ctx.profileName}" has auth disabled — nothing to log in to. ` +
        'Set profile.authEnabled=true and keycloak settings if this deployment enforces auth.',
    );
  }
  return ctx.profile.keycloak;
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Log in via SSO (Keycloak → company IdP). Opens your browser by default.')
    .option('--device', 'use the device-code flow (for SSH/headless machines)')
    .option('--no-browser', 'print the login URL instead of opening a browser')
    .action(
      runAction(async (ctx, opts: { device?: boolean; browser?: boolean }) => {
        const kc = requireKeycloak(ctx);
        let tokens;
        if (opts.device) {
          tokens = await loginDevice(kc, {
            onPrompt: ({ userCode, verificationUri, verificationUriComplete }) => {
              process.stderr.write(
                `\nOn any device, open ${link(verificationUriComplete ?? verificationUri)}\n` +
                  `and confirm the code: ${pc.bold(userCode)}\n\nWaiting for approval...\n`,
              );
            },
          });
        } else {
          tokens = await loginPkce(kc, {
            noBrowser: opts.browser === false,
            onAuthUrl: url => {
              if (opts.browser === false) {
                process.stderr.write(`\nOpen this URL in your browser to log in:\n\n${url}\n\n`);
              } else {
                process.stderr.write(
                  `Opening your browser for SSO login... ${pc.dim('(--no-browser to print the URL)')}\n`,
                );
              }
            },
          });
        }
        saveTokens(ctx.profileName, tokens);
        const claims = decodeJwt(tokens.accessToken);
        const who = (claims.email as string) ?? (claims.preferred_username as string) ?? 'unknown';
        if (ctx.json) printJson({ loggedIn: true, profile: ctx.profileName, user: who });
        else process.stderr.write(`${pc.green('✓')} Logged in as ${pc.bold(who)} (profile: ${ctx.profileName})\n`);
      }),
    );

  program
    .command('logout')
    .description('Log out and remove cached tokens for the active profile')
    .action(
      runAction(async ctx => {
        const tokens = loadTokens(ctx.profileName);
        if (tokens && ctx.profile.keycloak) await endSession(ctx.profile.keycloak, tokens);
        const removed = clearTokens(ctx.profileName);
        if (ctx.json) printJson({ loggedOut: removed, profile: ctx.profileName });
        else
          process.stderr.write(
            removed ? `${pc.green('✓')} Logged out (profile: ${ctx.profileName})\n` : 'No active session.\n',
          );
      }),
    );

  program
    .command('whoami')
    .description('Show the logged-in user and token details')
    .action(
      runAction(async ctx => {
        if (!ctx.profile.authEnabled) {
          if (ctx.json) printJson({ authEnabled: false, profile: ctx.profileName, apiUrl: ctx.api.baseUrl });
          else process.stdout.write(`Auth is disabled for profile "${ctx.profileName}" (API: ${ctx.api.baseUrl})\n`);
          return;
        }
        const tokens = loadTokens(ctx.profileName);
        if (!tokens) throw new AuthError('Not logged in — run `lfc login`');
        const claims = decodeJwt(tokens.accessToken);
        const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
        const info = {
          profile: ctx.profileName,
          apiUrl: ctx.api.baseUrl,
          email: claims.email ?? null,
          name: [claims.given_name, claims.family_name].filter(Boolean).join(' ') || null,
          username: claims.preferred_username ?? null,
          githubUsername: claims.github_username ?? null,
          roles: realmAccess?.roles?.filter(r => ['user', 'admin'].includes(r)) ?? [],
          accessTokenExpires: new Date(tokens.expiresAt).toISOString(),
          hasRefreshToken: Boolean(tokens.refreshToken),
        };
        if (ctx.json) {
          printJson(info);
          return;
        }
        clack.intro(pc.bold('lfc whoami'));
        process.stdout.write(
          [
            `  user        ${pc.bold(String(info.email ?? info.username ?? 'unknown'))}${info.name ? pc.dim(` (${info.name})`) : ''}`,
            `  github      ${info.githubUsername ?? pc.dim('not linked')}`,
            `  roles       ${info.roles.join(', ') || pc.dim('none')}`,
            `  profile     ${info.profile}`,
            `  api         ${info.apiUrl}`,
            `  token exp   ${info.accessTokenExpires}${tokens.expiresAt < Date.now() ? pc.yellow(' (expired — auto-refreshes on use)') : ''}`,
          ].join('\n') + '\n',
        );
        clack.outro(pc.dim('tokens cached in ~/.config/lifecycle-cli/tokens/'));
      }),
    );
}
