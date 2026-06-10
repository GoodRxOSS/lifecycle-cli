import { Command } from 'commander';
import pc from 'picocolors';

import { runAction } from '../lib/context.js';
import { formatAge, link, printJson, renderTable, statusColor } from '../lib/output.js';

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
