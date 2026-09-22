import fs from 'node:fs';

import * as clack from '@clack/prompts';
import { Command, Option } from 'commander';
import pc from 'picocolors';

import { runAction, type Ctx } from '../lib/context.js';
import { formatAge, formatBytes, link, printJson, renderTable, statusColor } from '../lib/output.js';
import { siteListView, validateSiteVisibility } from '../lib/sites.js';
import type { Site, SitesCapabilities, SiteVisibility } from '../lib/types.js';
import { prepareSiteUpload, type PreparedSiteUpload } from '../lib/zip.js';

/** Build the multipart form for a site upload from a zip, html file, or directory. */
async function uploadForm(upload: PreparedSiteUpload, name?: string, visibility?: SiteVisibility): Promise<FormData> {
  const form = new FormData();
  form.append('file', await fs.openAsBlob(upload.filePath, { type: upload.contentType }), upload.fileName);
  if (name) form.append('name', name);
  if (visibility) form.append('visibility', visibility);
  return form;
}

async function prepareUpload(ctx: Ctx, target: string, capabilities?: SitesCapabilities): Promise<PreparedSiteUpload> {
  return prepareSiteUpload(target, capabilities ?? (await ctx.api.getSitesCapabilities()));
}

async function confirmVisibility(
  visibility: SiteVisibility,
  yes?: boolean,
  reason: 'explicit' | 'default' = 'explicit',
): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error('Use --yes to confirm a visibility change in non-interactive mode');
  const ok = await clack.confirm({
    message:
      visibility === 'public'
        ? reason === 'default'
          ? 'This will be public by default for your credential — anyone with the link can view it. Continue?'
          : 'Publish this site so anyone with the link can view it?'
        : 'Make this site private? Its URL stays the same, but saved copies cannot be recalled.',
  });
  if (ok !== true) {
    process.stderr.write('Aborted.\n');
    return false;
  }
  return true;
}

function printSite(ctx: Ctx, site: Site, verb: string): void {
  if (ctx.json) {
    printJson(site);
    return;
  }
  process.stderr.write(`${pc.green('✓')} ${verb} site ${pc.bold(site.id)}${site.name ? ` (${site.name})` : ''}\n`);
  process.stdout.write(`${site.openUrl}\n`);
  const extras: string[] = [site.visibility === 'private' ? 'private · only you' : 'public · anyone with the link'];
  if (site.fileCount != null) extras.push(`${site.fileCount} files`);
  if (site.sizeBytes != null) extras.push(formatBytes(site.sizeBytes));
  if (site.expiresAt) extras.push(`expires ${new Date(site.expiresAt).toLocaleString()}`);
  if (extras.length) process.stderr.write(pc.dim(`  ${extras.join(' · ')}\n`));
}

export function registerSitesCommands(program: Command): void {
  const sites = program
    .command('sites')
    .alias('site')
    .description('Host static sites (HTML/ZIP/directory) on Lifecycle');

  sites
    .command('list')
    .description('List hosted sites')
    .option('-m, --mine', 'only sites owned by this identity')
    .option('--public', 'only public sites')
    .option('--search <query>', 'search site name or id')
    .option('-p, --page <n>', 'page number', v => Number(v), 1)
    .option('-n, --limit <n>', 'items per page', v => Number(v), 25)
    .action(
      runAction(
        async (ctx, opts: { mine?: boolean; public?: boolean; search?: string; page: number; limit: number }) => {
          const view = siteListView(opts);
          const { items, pagination } = await ctx.api.listSites({
            page: opts.page,
            limit: opts.limit,
            view,
            q: opts.search,
          });
          if (ctx.json) {
            printJson({ sites: items, pagination });
            return;
          }
          if (items.length === 0) {
            process.stdout.write(pc.dim('No sites found.\n'));
            return;
          }
          const rows = items.map(s => [
            pc.bold(s.id),
            s.name ?? '',
            statusColor(s.status),
            link(s.openUrl),
            formatBytes(s.sizeBytes),
            s.expiresAt ? formatAge(s.expiresAt).replace(' ago', '') : '∞',
            s.visibility,
            s.currentRole === 'owner' ? 'owner' : 'view only',
          ]);
          process.stdout.write(
            renderTable(['id', 'name', 'status', 'url', 'size', 'expires in', 'visibility', 'access'], rows) + '\n',
          );
          if (pagination?.total && Number(pagination.total) > 1) {
            process.stdout.write(
              pc.dim(`page ${pagination.current}/${pagination.total} · ${pagination.items} total\n`),
            );
          }
        },
      ),
    );

  sites
    .command('create <path>')
    .description('Upload a .zip, .html file, or directory and get back the site id + URL')
    .option('--name <name>', 'display name for the site')
    .addOption(
      new Option('--visibility <visibility>', 'private or public; defaults depend on your credential').choices([
        'private',
        'public',
      ]),
    )
    .option('-y, --yes', 'confirm public publishing without a prompt')
    .action(
      runAction(async (ctx, target: string, opts: { name?: string; visibility?: SiteVisibility; yes?: boolean }) => {
        const capabilities = await ctx.api.getSitesCapabilities();
        if (!capabilities.enabled || !capabilities.canCreate)
          throw new Error('Creating Sites is unavailable for this credential.');
        validateSiteVisibility(opts.visibility, capabilities);
        const effectiveVisibility = opts.visibility ?? capabilities.defaultVisibility;
        if (effectiveVisibility === 'public') {
          const reason = opts.visibility === 'public' ? 'explicit' : 'default';
          if (!(await confirmVisibility('public', opts.yes, reason))) return;
        }
        const upload = await prepareUpload(ctx, target, capabilities);
        try {
          const form = await uploadForm(upload, opts.name, opts.visibility);
          const site = await ctx.api.createSite(form);
          printSite(ctx, site, 'Created');
        } finally {
          await upload.cleanup();
        }
      }),
    );

  sites
    .command('get <siteId>')
    .description("Show a site's details")
    .action(
      runAction(async (ctx, siteId: string) => {
        const site = await ctx.api.getSite(siteId);
        if (ctx.json) {
          printJson(site);
          return;
        }
        process.stdout.write(`${pc.bold(site.id)}${site.name ? `  ${site.name}` : ''}\n`);
        const fields: Array<[string, string]> = [
          ['status', statusColor(site.status)],
          ['url', link(site.openUrl)],
          ['content url', link(site.contentUrl)],
          ['visibility', site.visibility],
          ['access', site.currentRole === 'owner' ? 'owner' : 'view only'],
          ['size', `${formatBytes(site.sizeBytes)}${site.fileCount != null ? ` (${site.fileCount} files)` : ''}`],
          ['created', `${site.createdAt ?? ''} ${pc.dim(site.createdBy ?? '')}`],
          ['updated', `${site.updatedAt ?? ''} ${pc.dim(site.updatedBy ?? '')}`],
          ['expires', site.expiresAt ? new Date(site.expiresAt).toLocaleString() : 'never'],
        ];
        for (const [k, v] of fields) {
          if (v.trim()) process.stdout.write(`  ${pc.dim(k.padEnd(8))} ${v}\n`);
        }
      }),
    );

  sites
    .command('update <siteId> <path>')
    .description("Replace a site's content with a new .zip, .html file, or directory")
    .action(
      runAction(async (ctx, siteId: string, target: string) => {
        const current = await ctx.api.getSite(siteId);
        if (!current.permissions.canEdit)
          throw new Error('Your current access does not allow you to replace its content.');
        const upload = await prepareUpload(ctx, target);
        try {
          const form = await uploadForm(upload);
          form.append('expectedAccessRevision', String(current.accessRevision));
          form.append('expectedContentRevision', String(current.contentRevision));
          const site = await ctx.api.replaceSiteContent(siteId, form);
          printSite(ctx, site, 'Updated');
        } finally {
          await upload.cleanup();
        }
      }),
    );

  sites
    .command('extend <siteId>')
    .description("Extend a site's expiration (TTL)")
    .action(
      runAction(async (ctx, siteId: string) => {
        const current = await ctx.api.getSite(siteId);
        if (!current.permissions.canEdit)
          throw new Error('Your current access does not allow you to extend its expiry.');
        const site = await ctx.api.extendSite(siteId, current.accessRevision);
        if (ctx.json) printJson(site);
        else
          process.stderr.write(
            `${pc.green('✓')} Extended ${pc.bold(site.id)} — now expires ${site.expiresAt ? new Date(site.expiresAt).toLocaleString() : 'never'}\n`,
          );
      }),
    );

  sites
    .command('delete <siteId>')
    .description('Delete a hosted site')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(
      runAction(async (ctx, siteId: string, opts: { yes?: boolean }) => {
        const current = await ctx.api.getSite(siteId);
        if (!current.permissions.canDelete)
          throw new Error('Your current access does not allow you to delete this site.');
        if (!opts.yes) {
          if (!process.stdin.isTTY) throw new Error('Refusing to delete without --yes in non-interactive mode');
          const ok = await clack.confirm({ message: `Delete site ${siteId}? Its URL stops working immediately.` });
          if (ok !== true) {
            process.stderr.write('Aborted.\n');
            return;
          }
        }
        const site = await ctx.api.deleteSite(siteId, current.accessRevision);
        if (ctx.json) printJson(site);
        else process.stderr.write(`${pc.green('✓')} Deleted site ${siteId}\n`);
      }),
    );
  sites
    .command('visibility <siteId> <visibility>')
    .description('Publish a site or make it private (keeps its content URL)')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(
      runAction(async (ctx, siteId: string, value: string, opts: { yes?: boolean }) => {
        if (value !== 'private' && value !== 'public') throw new Error('Visibility must be private or public.');
        const site = await ctx.api.getSite(siteId);
        if (!site.permissions.canChangeVisibility)
          throw new Error('Your current access does not allow you to change its visibility.');
        if (site.visibility === value) {
          printSite(ctx, site, 'Unchanged');
          return;
        }
        if (!(await confirmVisibility(value, opts.yes))) return;
        printSite(ctx, await ctx.api.setSiteVisibility(siteId, value, site.accessRevision), 'Updated');
      }),
    );
}
