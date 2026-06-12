import * as p from '@clack/prompts';
import { Command } from 'commander';
import pc from 'picocolors';

import { runAction, type Ctx } from '../lib/context.js';
import { streamPodLogs } from '../lib/logs.js';
import { formatAge, formatDuration, link, printJson, renderTable, statusColor } from '../lib/output.js';
import type { LogStreamInfo } from '../lib/types.js';

export function registerServicesCommands(program: Command): void {
  const services = program.command('services').alias('svc').description('Deployed services within a build');

  services
    .command('list <buildUuid>')
    .description('List a build\'s services with status and links')
    .option('--all', 'include inactive (disabled) services')
    .action(
      runAction(async (ctx, buildUuid: string, opts: { all?: boolean }) => {
        const build = await ctx.api.getBuild(buildUuid);
        const deploys = (build.deploys ?? []).filter((d) => opts.all || d.active);
        if (ctx.json) {
          printJson({
            build: build.uuid,
            services: deploys.map((d) => ({
              name: d.deployable?.name,
              status: d.status,
              statusMessage: d.statusMessage,
              active: d.active,
              branch: d.branchName,
              publicUrl: d.publicUrl,
              internalHostname: d.cname,
              dockerImage: d.dockerImage,
              sha: d.sha,
              repository: d.repository?.fullName,
              updatedAt: d.updatedAt,
            })),
          });
          return;
        }
        if (deploys.length === 0) {
          process.stdout.write(pc.dim('No services found.\n'));
          return;
        }
        const rows = deploys.map((d) => [
          `${d.deployable?.name ?? d.uuid}${d.active ? '' : pc.dim(' (off)')}`,
          statusColor(d.status),
          d.branchName ?? '',
          d.publicUrl ? link(d.publicUrl) : pc.dim('—'),
          d.sha?.slice(0, 8) ?? '',
          formatAge(d.updatedAt),
        ]);
        process.stdout.write(`${pc.bold(build.uuid)}  ${statusColor(build.status)}\n\n`);
        process.stdout.write(renderTable(['service', 'status', 'branch', 'url', 'sha', 'updated'], rows) + '\n');
      })
    );

  services
    .command('redeploy <buildUuid> <name>')
    .description('Rebuild and redeploy a single service in a build')
    .action(
      runAction(async (ctx, buildUuid: string, name: string) => {
        const result = await ctx.api.redeployService(buildUuid, name);
        if (ctx.json) printJson({ build: buildUuid, service: name, redeploy: result ?? 'queued' });
        else
          process.stderr.write(
            `${pc.green('✓')} Redeploy queued for service ${pc.bold(name)} in ${buildUuid}\n` +
              pc.dim(`  follow with: lfc builds status ${buildUuid} --watch\n`)
          );
      })
    );

  services
    .command('enable <buildUuid> <name>')
    .description('Enable an optional service in a build')
    .action(
      runAction(async (ctx, buildUuid: string, name: string) => {
        const result = await ctx.api.patchServiceOverrides(buildUuid, [{ name, active: true }]);
        if (ctx.json) printJson(result);
        else process.stderr.write(`${pc.green('✓')} Enabled ${name} in ${buildUuid}\n`);
      })
    );

  services
    .command('disable <buildUuid> <name>')
    .description('Disable a service in a build')
    .action(
      runAction(async (ctx, buildUuid: string, name: string) => {
        const result = await ctx.api.patchServiceOverrides(buildUuid, [{ name, active: false }]);
        if (ctx.json) printJson(result);
        else process.stderr.write(`${pc.green('✓')} Disabled ${name} in ${buildUuid}\n`);
      })
    );

  services
    .command('history <buildUuid> <name>')
    .description('Build and deploy job history for a service (status, sha, engine, duration)')
    .action(
      runAction(async (ctx, buildUuid: string, name: string) => {
        const [buildJobs, deployJobs] = await Promise.all([
          ctx.api.listBuildJobs(buildUuid, name),
          ctx.api.listDeployJobs(buildUuid, name),
        ]);
        if (ctx.json) {
          printJson({ build: buildUuid, service: name, buildJobs, deployJobs });
          return;
        }
        process.stdout.write(pc.bold('build jobs\n'));
        if (buildJobs.length === 0) process.stdout.write(pc.dim('  (none)\n'));
        else {
          const rows = buildJobs.map((j) => [
            j.jobName,
            statusColor(j.status),
            j.sha?.slice(0, 8) ?? '',
            j.engine,
            formatDuration(j.duration),
            formatAge(j.startedAt),
            j.source === 'archived' ? pc.dim('archived') : '',
          ]);
          process.stdout.write(renderTable(['job', 'status', 'sha', 'engine', 'duration', 'started', ''], rows) + '\n');
        }
        process.stdout.write(pc.bold('\ndeploy jobs\n'));
        if (deployJobs.length === 0) process.stdout.write(pc.dim('  (none)\n'));
        else {
          const rows = deployJobs.map((j) => [
            j.jobName,
            statusColor(j.status),
            j.sha?.slice(0, 8) ?? '',
            j.deploymentType,
            formatDuration(j.duration),
            formatAge(j.startedAt),
            j.source === 'archived' ? pc.dim('archived') : '',
          ]);
          process.stdout.write(renderTable(['job', 'status', 'sha', 'type', 'duration', 'started', ''], rows) + '\n');
        }
        const failed = [...buildJobs, ...deployJobs].filter((j) => j.error);
        for (const j of failed) process.stdout.write(pc.red(`\n${j.jobName}: ${j.error}\n`));
      })
    );

  services
    .command('logs <buildUuid> <name>')
    .description('Show logs for a service\'s latest build or deploy job (archived or live)')
    .option('--deploy', 'deploy-job logs instead of build-job logs', false)
    .option('--job <jobName>', 'a specific job (see lfc services history)')
    .option('-f, --follow', 'keep following while the job is running', false)
    .option('--tail <lines>', 'lines of history to fetch when streaming', '500')
    .option('--timestamps', 'prefix each line with its timestamp', false)
    .action(
      runAction(
        async (
          ctx,
          buildUuid: string,
          name: string,
          opts: { deploy: boolean; job?: string; follow: boolean; tail: string; timestamps: boolean }
        ) => {
          const kind = opts.deploy ? 'deploy' : 'build';
          let jobName = opts.job;
          if (!jobName) {
            const jobs = opts.deploy
              ? await ctx.api.listDeployJobs(buildUuid, name)
              : await ctx.api.listBuildJobs(buildUuid, name);
            if (jobs.length === 0) throw new Error(`No ${kind} jobs found for ${name}`);
            jobs.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
            jobName = jobs[0]!.jobName;
            if (!ctx.quiet && !ctx.json) process.stderr.write(pc.dim(`latest ${kind} job: ${jobName}\n`));
          }
          if (!jobName) throw new Error(`No ${kind} job selected for ${name}`);
          const info = await ctx.api.getJobLogInfo(buildUuid, name, jobName, kind);
          await printJobLogs(ctx, buildUuid, jobName, info, opts);
        }
      )
    );

  services
    .command('edit <buildUuid>')
    .description('Interactively enable/disable services and edit their branches (like the PR comment)')
    .action(
      runAction(async (ctx, buildUuid: string) => {
        if (!process.stdin.isTTY) {
          throw new Error('services edit is interactive — use services enable/disable/set-branch in scripts');
        }
        await editServicesInteractive(ctx, buildUuid);
      })
    );

  services
    .command('set-branch <buildUuid> <name> <branchOrUrl>')
    .description('Point a service at a different branch (or external URL)')
    .action(
      runAction(async (ctx, buildUuid: string, name: string, branchOrUrl: string) => {
        const result = await ctx.api.patchServiceOverrides(buildUuid, [{ name, branchOrExternalUrl: branchOrUrl }]);
        if (ctx.json) printJson(result);
        else process.stderr.write(`${pc.green('✓')} ${name} in ${buildUuid} now tracks ${pc.bold(branchOrUrl)}\n`);
      })
    );
}

async function printJobLogs(
  ctx: Ctx,
  buildUuid: string,
  jobName: string,
  info: LogStreamInfo,
  opts: { follow: boolean; tail: string; timestamps: boolean }
): Promise<void> {
  if (info.archivedLogs !== undefined) {
    if (!ctx.quiet && !ctx.json) process.stderr.write(pc.dim(`— archived logs for ${jobName} —\n`));
    process.stdout.write(info.archivedLogs.endsWith('\n') ? info.archivedLogs : `${info.archivedLogs}\n`);
    return;
  }
  if (!info.websocket || !info.podName) {
    throw new Error(info.error || info.message || `No logs available for job ${jobName} (status: ${info.status})`);
  }
  const containers = info.containers ?? [];
  // same default as the UI job log view: the last (main) container
  const containerName = containers.length > 0 ? containers[containers.length - 1]!.name : 'main';
  const tailLines = Number.parseInt(opts.tail, 10);
  if (Number.isNaN(tailLines) || tailLines < 0) throw new Error(`Invalid --tail value "${opts.tail}"`);
  await streamPodLogs(
    ctx.api.baseUrl,
    {
      podName: info.podName,
      namespace: info.websocket.parameters.namespace,
      containerName,
      follow: opts.follow && info.websocket.parameters.follow,
      tailLines,
      timestamps: opts.timestamps,
    },
    { quiet: ctx.quiet || ctx.json }
  );
}

async function editServicesInteractive(ctx: Ctx, buildUuid: string): Promise<void> {
  const build = await ctx.api.getBuild(buildUuid);
  const deploys = (build.deploys ?? []).filter((d) => d.deployable?.name);
  if (deploys.length === 0) throw new Error('No services found for this build');

  const current = deploys.map((d) => ({
    name: d.deployable!.name,
    active: d.active,
    branch: d.serviceOverride?.branchOrExternalUrl ?? d.branchName ?? '',
  }));

  p.intro(`${pc.bold(buildUuid)}  ${statusColor(build.status)}`);

  const selected = await p.multiselect({
    message: 'Services to deploy (space toggles, like the PR comment checkboxes)',
    options: current.map((s) => ({ value: s.name, label: s.name, hint: s.branch })),
    initialValues: current.filter((s) => s.active).map((s) => s.name),
    required: false,
  });
  if (p.isCancel(selected)) {
    p.cancel('No changes made.');
    return;
  }
  const activeSet = new Set(selected as string[]);

  const branchEdits = new Map<string, string>();
  for (;;) {
    const editable = current.filter((s) => activeSet.has(s.name));
    const choice = await p.select({
      message: 'Edit a service branch?',
      options: [
        { value: '', label: 'No — apply changes' },
        ...editable.map((s) => ({
          value: s.name,
          label: s.name,
          hint: branchEdits.get(s.name) ?? s.branch,
        })),
      ],
    });
    if (p.isCancel(choice)) {
      p.cancel('No changes made.');
      return;
    }
    if (!choice) break;
    const svc = current.find((s) => s.name === choice)!;
    const branch = await p.text({
      message: `Branch or external URL for ${choice}`,
      initialValue: branchEdits.get(choice as string) ?? svc.branch,
    });
    if (p.isCancel(branch)) continue;
    if (branch && branch !== svc.branch) branchEdits.set(choice as string, branch);
    else branchEdits.delete(choice as string);
  }

  const overrides: Array<{ name: string; active?: boolean; branchOrExternalUrl?: string }> = [];
  for (const s of current) {
    const wantActive = activeSet.has(s.name);
    const branch = branchEdits.get(s.name);
    const change: { name: string; active?: boolean; branchOrExternalUrl?: string } = { name: s.name };
    if (wantActive !== s.active) change.active = wantActive;
    if (branch !== undefined) change.branchOrExternalUrl = branch;
    if (change.active !== undefined || change.branchOrExternalUrl !== undefined) overrides.push(change);
  }

  if (overrides.length === 0) {
    p.outro('No changes.');
    return;
  }

  const summary = overrides
    .map((o) => {
      const parts: string[] = [];
      if (o.active !== undefined) parts.push(o.active ? pc.green('enable') : pc.red('disable'));
      if (o.branchOrExternalUrl !== undefined) parts.push(`branch → ${pc.bold(o.branchOrExternalUrl)}`);
      return `  ${o.name}: ${parts.join(', ')}`;
    })
    .join('\n');
  const ok = await p.confirm({ message: `Apply these changes? (triggers a redeploy)\n${summary}` });
  if (p.isCancel(ok) || !ok) {
    p.cancel('No changes made.');
    return;
  }

  const result = await ctx.api.patchServiceOverrides(buildUuid, overrides);
  if (ctx.json) printJson(result);
  p.outro(`${pc.green('✓')} Updated ${overrides.length} service(s) — follow with: lfc builds status ${buildUuid} --watch`);
}
