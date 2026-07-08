import * as clack from '@clack/prompts';
import { Command } from 'commander';
import pc from 'picocolors';

import { openBrowser } from '../lib/auth.js';
import { runAction, type Ctx } from '../lib/context.js';
import { formatAge, link, parseDuration, printJson, renderTable, statusColor } from '../lib/output.js';
import { parseSelector, pickBuild } from '../lib/resolve.js';
import { BUILD_TERMINAL_FAILURE, BUILD_TERMINAL_SUCCESS, type Build, type Deploy } from '../lib/types.js';

function buildUiUrl(ctx: Ctx, uuid: string): string | undefined {
  return ctx.uiUrl ? `${ctx.uiUrl}/environments/${uuid}` : undefined;
}

function prLabel(build: { pullRequest?: { fullName?: string; pullRequestNumber?: number; title?: string } | null }): string {
  const pr = build.pullRequest;
  if (!pr) return '';
  return `${pr.fullName}#${pr.pullRequestNumber}`;
}

function activeDeploys(build: Build): Deploy[] {
  return (build.deploys ?? []).filter((d) => d.active);
}

function serviceRows(build: Build): string[][] {
  return activeDeploys(build).map((d) => [
    d.deployable?.name ?? d.uuid,
    statusColor(d.status),
    d.branchName ?? '',
    d.publicUrl ? link(d.publicUrl) : pc.dim('—'),
    formatAge(d.updatedAt),
  ]);
}

function summarizeServices(deploys: Array<{ status: string; active: boolean }>): string {
  const active = deploys.filter((d) => d.active);
  const deployed = active.filter((d) => d.status === 'ready' || d.status === 'deployed').length;
  const failed = active.filter((d) => d.status.includes('error') || d.status.includes('failed')).length;
  let summary = `${deployed}/${active.length}`;
  if (failed > 0) summary += pc.red(` (${failed} failed)`);
  return summary;
}

async function watchBuild(ctx: Ctx, uuid: string, intervalMs: number, timeoutMs: number, timeoutLabel: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const isTty = process.stdout.isTTY;
  let firstRender = true;
  let lineCount = 0;

  for (;;) {
    const build = await ctx.api.getBuild(uuid);
    const rows = serviceRows(build);
    const table = rows.length > 0 ? renderTable(['service', 'status', 'branch', 'url', 'updated'], rows) : '';
    const header = `${pc.bold(build.uuid)}  ${statusColor(build.status)}  ${pc.dim(new Date().toLocaleTimeString())}`;
    const frame = [header, ...(table ? ['', table] : [])].join('\n');

    if (isTty && !firstRender) {
      process.stdout.write(`\x1b[${lineCount}A\x1b[J`);
    }
    process.stdout.write(frame + '\n');
    lineCount = frame.split('\n').length;
    firstRender = false;

    if (BUILD_TERMINAL_SUCCESS.has(build.status)) {
      process.stdout.write(`${pc.green('✓')} ${build.uuid} is deployed\n`);
      return;
    }
    if (BUILD_TERMINAL_FAILURE.has(build.status)) {
      process.stdout.write(`${pc.red('✗')} ${build.uuid} ended in ${build.status}${build.statusMessage ? `: ${build.statusMessage}` : ''}\n`);
      process.exitCode = 1;
      return;
    }
    if (Date.now() > deadline) {
      process.stdout.write(`${pc.yellow('!')} timed out after ${timeoutLabel} (build still ${build.status})\n`);
      process.exitCode = 2;
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Render a build's detail block (status, PR, services, env overrides). Shared by `get` and `find`. */
function renderBuildDetail(ctx: Ctx, build: Build): void {
  const pr = build.pullRequest;
  const ui = buildUiUrl(ctx, build.uuid);
  const fields: Array<[string, string]> = [
    ['status', `${statusColor(build.status)}${build.statusMessage ? pc.dim(`  ${build.statusMessage}`) : ''}`],
    ['namespace', build.namespace ?? ''],
    ['kind', `${build.kind ?? 'environment'}${build.isStatic ? ' (static)' : ''}`],
    ['sha', build.sha?.slice(0, 12) ?? ''],
    ['pr', pr ? `${prLabel(build)} ${pc.dim(pr.title ?? '')}` : pc.dim('none')],
    ['branch', pr?.branchName ?? ''],
    ['author', pr?.githubLogin ?? ''],
    ['updated', `${build.updatedAt ?? ''} ${pc.dim(formatAge(build.updatedAt))}`],
    ['ui', ui ? link(ui) : ''],
  ];
  process.stdout.write(`${pc.bold(build.uuid)}\n`);
  for (const [k, v] of fields) {
    if (v) process.stdout.write(`  ${pc.dim(k.padEnd(10))} ${v}\n`);
  }
  const rows = serviceRows(build);
  if (rows.length > 0) {
    process.stdout.write(`\n${renderTable(['service', 'status', 'branch', 'url', 'updated'], rows)}\n`);
  }
  const runtimeEnv = build.commentRuntimeEnv ?? {};
  const initEnv = build.commentInitEnv ?? {};
  if (Object.keys(runtimeEnv).length || Object.keys(initEnv).length) {
    process.stdout.write(`\n${pc.bold('env overrides')}\n`);
    for (const [k, v] of Object.entries(runtimeEnv)) process.stdout.write(`  ${k}=${v}\n`);
    for (const [k, v] of Object.entries(initEnv)) process.stdout.write(`  ${pc.dim('(init)')} ${k}=${v}\n`);
  }
}

async function renderStatusOnce(ctx: Ctx, uuid: string): Promise<Build> {
  const build = await ctx.api.getBuild(uuid);
  const lines: string[] = [];
  lines.push(`${pc.bold(build.uuid)}  ${statusColor(build.status)}${build.statusMessage ? pc.dim(`  ${build.statusMessage}`) : ''}`);
  const rows = serviceRows(build);
  if (rows.length > 0) lines.push('', renderTable(['service', 'status', 'branch', 'url', 'updated'], rows));
  process.stdout.write(lines.join('\n') + '\n');
  return build;
}

export function registerBuildsCommands(program: Command): void {
  const builds = program.command('builds').alias('build').description('View and manage builds (preview environments)');

  builds
    .command('list')
    .description('List builds')
    .option('-s, --search <query>', 'search by uuid, namespace, PR title, repo, or author')
    .option('-m, --mine', 'only my environments (matched via GitHub username)')
    .option('--exclude <statuses>', 'comma-separated statuses to exclude', 'torn_down,pending')
    .option('--all', 'include all statuses (no exclusions)')
    .option('-p, --page <n>', 'page number', (v) => Number(v), 1)
    .option('-n, --limit <n>', 'items per page', (v) => Number(v), 25)
    .action(
      runAction(async (ctx, opts: { search?: string; mine?: boolean; exclude: string; all?: boolean; page: number; limit: number }) => {
        const { items, pagination } = await ctx.api.listBuilds({
          page: opts.page,
          limit: opts.limit,
          search: opts.search,
          exclude: opts.all ? '' : opts.exclude,
          myEnvs: opts.mine,
        });
        if (ctx.json) {
          printJson({ builds: items, pagination });
          return;
        }
        if (items.length === 0) {
          process.stdout.write(pc.dim('No builds found.\n'));
          return;
        }
        const rows = items.map((b) => [
          pc.bold(b.uuid),
          statusColor(b.status),
          prLabel(b),
          b.pullRequest?.branchName ?? '',
          b.pullRequest?.githubLogin ?? '',
          summarizeServices(b.deploys ?? []),
          formatAge(b.updatedAt),
        ]);
        process.stdout.write(renderTable(['uuid', 'status', 'pr', 'branch', 'author', 'services', 'updated'], rows) + '\n');
        if (pagination?.totalPages && Number(pagination.totalPages) > 1) {
          process.stdout.write(pc.dim(`page ${pagination.page}/${pagination.totalPages} · ${pagination.totalItems} total · -p <n> for more\n`));
        }
      })
    );

  builds
    .command('get <uuid>')
    .description('Show a build in detail: status, PR, services and links')
    .option('--manifest', 'also print the build manifest (YAML/JSON as stored)')
    .action(
      runAction(async (ctx, uuid: string, opts: { manifest?: boolean }) => {
        const build = await ctx.api.getBuild(uuid);
        if (ctx.json) {
          printJson(build);
          return;
        }
        renderBuildDetail(ctx, build);
        if (opts.manifest && build.manifest) {
          process.stdout.write(`\n${pc.bold('manifest')}\n`);
          process.stdout.write(typeof build.manifest === 'string' ? `${build.manifest}\n` : `${JSON.stringify(build.manifest, null, 2)}\n`);
        }
      })
    );

  builds
    .command('find')
    .description('Find a build by PR or branch and resolve it to a uuid (agent-friendly)')
    .option('--pr <url|number>', 'GitHub PR URL, or a PR number (a bare number needs --repo)')
    .option('--branch <name>', 'branch name (needs --repo)')
    .option('--repo <org/repo>', 'repository; required unless --pr is a full PR URL')
    .action(
      runAction(async (ctx, opts: { pr?: string; branch?: string; repo?: string }) => {
        const selector = parseSelector(opts);
        const target =
          selector.prNumber !== undefined ? `${selector.repo}#${selector.prNumber}` : `${selector.repo}@${selector.branch}`;
        const { matches, truncated } = await ctx.api.resolveBuild(selector);
        const chosen = pickBuild(matches);

        if (!chosen) {
          if (truncated) {
            process.stderr.write(
              `${pc.yellow('!')} No build matched ${target} in the pages scanned — results may be truncated. ` +
                `Double-check the repo/branch, or read the uuid from the PR comment.\n`
            );
            process.exitCode = 1;
          } else {
            process.stderr.write(
              `${pc.dim(`No build found for ${target}. If the PR was just opened, Lifecycle may not have created the environment yet.`)}\n`
            );
            process.exitCode = 3;
          }
          if (ctx.json) printJson({ found: false, target, truncated });
          return;
        }

        // The list payload is trimmed; fetch the full build so output matches `builds get`.
        const build = await ctx.api.getBuild(chosen.uuid);
        const others = matches.filter((m) => m.uuid !== chosen.uuid).map((m) => m.uuid);
        if (others.length > 0) {
          process.stderr.write(
            `${pc.yellow('!')} ${matches.length} builds matched ${target}; showing most recent ${pc.bold(chosen.uuid)}. Others: ${others.join(', ')}\n`
          );
        }
        if (ctx.json) {
          // Uniform envelope (`found` always present) so callers can branch on it,
          // and multiple matches are visible in JSON, not just on stderr.
          printJson({ found: true, build, matches: matches.map((m) => m.uuid) });
          return;
        }
        renderBuildDetail(ctx, build);
      })
    );

  builds
    .command('status <uuid>')
    .description('Show build status; --watch polls until it converges (exit 0 deployed, 1 failed, 2 timeout)')
    .option('-w, --watch', 'poll until the build reaches a terminal state')
    .option('--interval <dur>', 'poll interval (e.g. 5s, 30s)', '5s')
    .option('--timeout <dur>', 'give up after this long', '30m')
    .action(
      runAction(async (ctx, uuid: string, opts: { watch?: boolean; interval: string; timeout: string }) => {
        if (!opts.watch || ctx.json) {
          const build = await ctx.api.getBuild(uuid);
          if (ctx.json) {
            printJson({
              uuid: build.uuid,
              status: build.status,
              statusMessage: build.statusMessage,
              services: activeDeploys(build).map((d) => ({
                name: d.deployable?.name,
                status: d.status,
                statusMessage: d.statusMessage,
                publicUrl: d.publicUrl,
                branch: d.branchName,
                sha: d.sha,
              })),
            });
          } else {
            await renderStatusOnce(ctx, uuid);
          }
          if (BUILD_TERMINAL_FAILURE.has(build.status)) process.exitCode = 1;
          return;
        }

        await watchBuild(ctx, uuid, parseDuration(opts.interval), parseDuration(opts.timeout), opts.timeout);
      })
    );

  builds
    .command('redeploy <uuid>')
    .description('Redeploy the whole build (all services)')
    .option('-w, --watch', 'watch until the redeploy converges')
    .action(
      runAction(async (ctx, uuid: string, opts: { watch?: boolean }) => {
        const result = await ctx.api.redeployBuild(uuid);
        if (ctx.json && !opts.watch) {
          printJson({ uuid, redeploy: result ?? 'queued' });
          return;
        }
        process.stderr.write(`${pc.green('✓')} Redeploy queued for ${pc.bold(uuid)}\n`);
        if (opts.watch) {
          await new Promise((r) => setTimeout(r, 3000));
          await watchBuild(ctx, uuid, 5000, 30 * 60_000, '30m');
        }
      })
    );

  builds
    .command('destroy <uuid>')
    .description('Tear down a build (destructive)')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(
      runAction(async (ctx, uuid: string, opts: { yes?: boolean }) => {
        if (!opts.yes) {
          if (!process.stdin.isTTY) throw new Error('Refusing to destroy without --yes in non-interactive mode');
          const ok = await clack.confirm({ message: `Tear down build ${uuid}? This deletes its namespace and services.` });
          if (ok !== true) {
            process.stderr.write('Aborted.\n');
            return;
          }
        }
        const result = await ctx.api.destroyBuild(uuid);
        if (ctx.json) printJson({ uuid, destroy: result ?? 'queued' });
        else process.stderr.write(`${pc.green('✓')} Teardown queued for ${uuid}\n`);
      })
    );

  builds
    .command('update-uuid <uuid> <newUuid>')
    .description('Rename a build environment (3-50 chars, lowercase letters/numbers/hyphens)')
    .action(
      runAction(async (ctx, uuid: string, newUuid: string) => {
        const build = await ctx.api.patchBuild(uuid, { uuid: newUuid });
        if (ctx.json) printJson(build);
        else {
          process.stderr.write(`${pc.green('✓')} ${uuid} → ${pc.bold(build.uuid)} (namespace: ${build.namespace})\n`);
          const ui = buildUiUrl(ctx, build.uuid);
          if (ui) process.stderr.write(`  ${link(ui)}\n`);
        }
      })
    );

  builds
    .command('set <uuid>')
    .description('Change build settings: static pin, default-branch tracking')
    .option('--static', 'pin as a static environment (no auto-teardown)')
    .option('--no-static', 'unpin the static environment')
    .option('--track-defaults', 'follow default branches for services without overrides')
    .option('--no-track-defaults', 'stop following default branches')
    .action(
      runAction(async (ctx, uuid: string, opts: { static?: boolean; trackDefaults?: boolean }) => {
        const patch: Record<string, unknown> = {};
        // commander negatable flags default to true when never passed — only patch what was given
        if (ctx.cmd.getOptionValueSource('static') === 'cli') patch.isStatic = opts.static;
        if (ctx.cmd.getOptionValueSource('trackDefaults') === 'cli') patch.trackDefaultBranches = opts.trackDefaults;
        if (Object.keys(patch).length === 0) {
          throw new Error('Nothing to change — pass --[no-]static and/or --[no-]track-defaults');
        }
        const build = await ctx.api.patchBuild(uuid, patch);
        if (ctx.json) printJson({ uuid: build.uuid, isStatic: build.isStatic, trackDefaultBranches: build.trackDefaultBranches });
        else {
          process.stderr.write(`${pc.green('✓')} ${build.uuid} updated\n`);
          process.stdout.write(`  static       ${build.isStatic ? pc.green('yes') : 'no'}\n`);
          process.stdout.write(`  track-defaults  ${build.trackDefaultBranches ? pc.green('yes') : 'no'}\n`);
        }
      })
    );

  builds
    .command('webhooks <uuid>')
    .description('List webhook invocations for a build, or trigger them')
    .option('--invoke', 'invoke the webhooks configured in the build\'s webhooksYaml', false)
    .action(
      runAction(async (ctx, uuid: string, opts: { invoke: boolean }) => {
        if (opts.invoke) {
          const result = await ctx.api.invokeWebhooks(uuid);
          if (ctx.json) printJson({ build: uuid, invoked: result ?? true });
          else process.stderr.write(`${pc.green('✓')} Webhooks invoked for ${uuid}\n`);
          return;
        }
        const invocations = await ctx.api.listWebhookInvocations(uuid);
        if (ctx.json) {
          printJson({ build: uuid, invocations });
          return;
        }
        if (invocations.length === 0) {
          process.stdout.write(pc.dim('No webhook invocations.\n'));
          return;
        }
        const rows = invocations.map((w) => [
          w.name,
          w.type,
          statusColor(w.status),
          w.runUUID,
          formatAge(w.createdAt),
        ]);
        process.stdout.write(renderTable(['name', 'type', 'status', 'run', 'when'], rows) + '\n');
      })
    );

  builds
    .command('open <uuid>')
    .description('Open the environment in the Lifecycle UI')
    .option('--print', 'print the URL instead of opening a browser', false)
    .action(
      runAction(async (ctx, uuid: string, opts: { print: boolean }) => {
        const url = buildUiUrl(ctx, uuid);
        if (!url) throw new Error('No uiUrl configured for this profile (lfc config set uiUrl <url>)');
        if (ctx.json) {
          printJson({ uuid, url });
          return;
        }
        process.stdout.write(`${link(url)}\n`);
        if (!opts.print) openBrowser(url);
      })
    );

  const env = builds.command('env').description('View and set comment env-var overrides on a build');

  env
    .command('get <uuid>')
    .description('Show runtime and init env overrides')
    .action(
      runAction(async (ctx, uuid: string) => {
        const build = await ctx.api.getBuild(uuid);
        const data = { runtime: build.commentRuntimeEnv ?? {}, init: build.commentInitEnv ?? {} };
        if (ctx.json) {
          printJson(data);
          return;
        }
        const print = (label: string, envs: Record<string, string>) => {
          process.stdout.write(`${pc.bold(label)}\n`);
          const entries = Object.entries(envs);
          if (entries.length === 0) process.stdout.write(pc.dim('  (none)\n'));
          for (const [k, v] of entries) process.stdout.write(`  ${k}=${v}\n`);
        };
        print('runtime env overrides', data.runtime);
        print('init env overrides', data.init);
      })
    );

  env
    .command('set <uuid> <pairs...>')
    .description('Set env overrides (KEY=VALUE ...); merges into existing overrides')
    .option('--init', 'target init env instead of runtime env')
    .action(
      runAction(async (ctx, uuid: string, pairs: string[], opts: { init?: boolean }) => {
        const build = await ctx.api.getBuild(uuid);
        const field = opts.init ? 'commentInitEnv' : 'commentRuntimeEnv';
        const merged: Record<string, string> = { ...((opts.init ? build.commentInitEnv : build.commentRuntimeEnv) ?? {}) };
        for (const pair of pairs) {
          const eq = pair.indexOf('=');
          if (eq < 1) throw new Error(`Invalid pair "${pair}" — expected KEY=VALUE`);
          merged[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
        const updated = await ctx.api.patchBuild(uuid, { [field]: merged });
        if (ctx.json) printJson({ runtime: updated.commentRuntimeEnv ?? {}, init: updated.commentInitEnv ?? {} });
        else process.stderr.write(`${pc.green('✓')} Updated ${opts.init ? 'init' : 'runtime'} env overrides on ${uuid} (${pairs.length} key${pairs.length > 1 ? 's' : ''})\n`);
      })
    );

  env
    .command('unset <uuid> <keys...>')
    .description('Remove env override keys')
    .option('--init', 'target init env instead of runtime env')
    .action(
      runAction(async (ctx, uuid: string, keys: string[], opts: { init?: boolean }) => {
        const build = await ctx.api.getBuild(uuid);
        const field = opts.init ? 'commentInitEnv' : 'commentRuntimeEnv';
        const current: Record<string, string> = { ...((opts.init ? build.commentInitEnv : build.commentRuntimeEnv) ?? {}) };
        for (const key of keys) delete current[key];
        const updated = await ctx.api.patchBuild(uuid, { [field]: current });
        if (ctx.json) printJson({ runtime: updated.commentRuntimeEnv ?? {}, init: updated.commentInitEnv ?? {} });
        else process.stderr.write(`${pc.green('✓')} Removed ${keys.join(', ')} from ${opts.init ? 'init' : 'runtime'} env overrides on ${uuid}\n`);
      })
    );
}
