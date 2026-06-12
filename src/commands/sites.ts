import fs from 'node:fs';

import * as clack from '@clack/prompts';
import { Command } from 'commander';
import pc from 'picocolors';

import { decodeJwt } from '../lib/auth.js';
import { loadTokens } from '../lib/config.js';
import { runAction, type Ctx } from '../lib/context.js';
import { formatAge, formatBytes, link, printJson, renderTable, statusColor } from '../lib/output.js';
import { prepareSiteUpload, type PreparedSiteUpload } from '../lib/zip.js';

/** Build the multipart form for a site upload from a zip, html file, or directory. */
async function uploadForm(upload: PreparedSiteUpload, name?: string): Promise<FormData> {
  const form = new FormData();
  form.append('file', await fs.openAsBlob(upload.filePath, { type: upload.contentType }), upload.fileName);
  if (name) form.append('name', name);
  return form;
}

async function prepareUpload(ctx: Ctx, target: string): Promise<PreparedSiteUpload> {
  let config;
  try {
    config = await ctx.api.getSitesConfig();
  } catch {
    throw new Error('Could not load sites lifecycle. Try again later.');
  }

  return prepareSiteUpload(target, config);
}

function userEmail(ctx: Ctx): string | undefined {
  const tokens = loadTokens(ctx.profileName);
  if (!tokens) return undefined;
  try {
    return decodeJwt(tokens.accessToken).email as string | undefined;
  } catch {
    return undefined;
  }
}

function printSite(ctx: Ctx, site: { id: string; url: string; name?: string | null; status: string; expiresAt?: string | null; fileCount?: number; sizeBytes?: number }, verb: string): void {
  if (ctx.json) {
    printJson(site);
    return;
  }
  process.stderr.write(`${pc.green('✓')} ${verb} site ${pc.bold(site.id)}${site.name ? ` (${site.name})` : ''}\n`);
  process.stdout.write(`${site.url}\n`);
  const extras: string[] = [];
  if (site.fileCount != null) extras.push(`${site.fileCount} files`);
  if (site.sizeBytes != null) extras.push(formatBytes(site.sizeBytes));
  if (site.expiresAt) extras.push(`expires ${new Date(site.expiresAt).toLocaleString()}`);
  if (extras.length) process.stderr.write(pc.dim(`  ${extras.join(' · ')}\n`));
}

export function registerSitesCommands(program: Command): void {
  const sites = program.command('sites').alias('site').description('Host static sites (HTML/ZIP/directory) on Lifecycle');

  sites
    .command('list')
    .description('List hosted sites')
    .option('-m, --mine', 'only sites created/updated by me')
    .option('-p, --page <n>', 'page number', (v) => Number(v), 1)
    .option('-n, --limit <n>', 'items per page', (v) => Number(v), 25)
    .action(
      runAction(async (ctx, opts: { mine?: boolean; page: number; limit: number }) => {
        const user = opts.mine ? userEmail(ctx) : undefined;
        if (opts.mine && !user) throw new Error('Cannot resolve your email — log in first (`lfc login`)');
        const { items, pagination } = await ctx.api.listSites({ page: opts.page, limit: opts.limit, user });
        if (ctx.json) {
          printJson({ sites: items, pagination });
          return;
        }
        if (items.length === 0) {
          process.stdout.write(pc.dim('No sites found.\n'));
          return;
        }
        const rows = items.map((s) => [
          pc.bold(s.id),
          s.name ?? '',
          statusColor(s.status),
          link(s.url),
          formatBytes(s.sizeBytes),
          s.expiresAt ? formatAge(s.expiresAt).replace(' ago', '') : '∞',
          s.createdBy ?? '',
        ]);
        process.stdout.write(renderTable(['id', 'name', 'status', 'url', 'size', 'expires in', 'created by'], rows) + '\n');
        if (pagination?.totalPages && Number(pagination.totalPages) > 1) {
          process.stdout.write(pc.dim(`page ${pagination.page}/${pagination.totalPages} · ${pagination.totalItems} total\n`));
        }
      })
    );

  sites
    .command('create <path>')
    .description('Upload a .zip, .html file, or directory and get back the site id + URL')
    .option('--name <name>', 'display name for the site')
    .action(
      runAction(async (ctx, target: string, opts: { name?: string }) => {
        const upload = await prepareUpload(ctx, target);
        try {
          const form = await uploadForm(upload, opts.name);
          const site = await ctx.api.createSite(form);
          printSite(ctx, site, 'Created');
        } finally {
          await upload.cleanup();
        }
      })
    );

  sites
    .command('get <siteId>')
    .description('Show a site\'s details')
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
          ['url', link(site.url)],
          ['size', `${formatBytes(site.sizeBytes)}${site.fileCount != null ? ` (${site.fileCount} files)` : ''}`],
          ['created', `${site.createdAt ?? ''} ${pc.dim(site.createdBy ?? '')}`],
          ['updated', `${site.updatedAt ?? ''} ${pc.dim(site.updatedBy ?? '')}`],
          ['expires', site.expiresAt ? new Date(site.expiresAt).toLocaleString() : 'never'],
        ];
        for (const [k, v] of fields) {
          if (v.trim()) process.stdout.write(`  ${pc.dim(k.padEnd(8))} ${v}\n`);
        }
      })
    );

  sites
    .command('update <siteId> <path>')
    .description('Replace a site\'s content with a new .zip, .html file, or directory')
    .action(
      runAction(async (ctx, siteId: string, target: string) => {
        const upload = await prepareUpload(ctx, target);
        try {
          const form = await uploadForm(upload);
          const site = await ctx.api.replaceSiteContent(siteId, form);
          printSite(ctx, site, 'Updated');
        } finally {
          await upload.cleanup();
        }
      })
    );

  sites
    .command('extend <siteId>')
    .description('Extend a site\'s expiration (TTL)')
    .action(
      runAction(async (ctx, siteId: string) => {
        const site = await ctx.api.extendSite(siteId);
        if (ctx.json) printJson(site);
        else
          process.stderr.write(
            `${pc.green('✓')} Extended ${pc.bold(site.id)} — now expires ${site.expiresAt ? new Date(site.expiresAt).toLocaleString() : 'never'}\n`
          );
      })
    );

  sites
    .command('delete <siteId>')
    .description('Delete a hosted site')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(
      runAction(async (ctx, siteId: string, opts: { yes?: boolean }) => {
        if (!opts.yes) {
          if (!process.stdin.isTTY) throw new Error('Refusing to delete without --yes in non-interactive mode');
          const ok = await clack.confirm({ message: `Delete site ${siteId}? Its URL stops working immediately.` });
          if (ok !== true) {
            process.stderr.write('Aborted.\n');
            return;
          }
        }
        const site = await ctx.api.deleteSite(siteId);
        if (ctx.json) printJson(site);
        else process.stderr.write(`${pc.green('✓')} Deleted site ${siteId}\n`);
      })
    );
}
