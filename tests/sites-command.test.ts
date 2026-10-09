import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { registerSitesCommands } from '../src/commands/sites.js';

const api = vi.hoisted(() => ({
  getSite: vi.fn(),
  getSitesCapabilities: vi.fn(),
  setSiteVisibility: vi.fn(),
  createSite: vi.fn(),
  listSites: vi.fn(),
  deleteSite: vi.fn(),
  restoreSite: vi.fn(),
}));
const ctxState = vi.hoisted(() => ({ json: true }));
const prompts = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../src/lib/context.js', () => ({
  runAction:
    (action: (ctx: unknown, ...args: unknown[]) => Promise<void>) =>
    (...args: unknown[]) =>
      action({ api, json: ctxState.json }, ...args.slice(0, -1)),
}));
vi.mock('../src/lib/output.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/output.js')>()),
  printJson: vi.fn(),
}));
vi.mock('@clack/prompts', () => prompts);
beforeEach(() => {
  vi.clearAllMocks();
  api.getSite.mockResolvedValue({
    id: 'owned',
    visibility: 'private',
    accessRevision: 7,
    permissions: { canChangeVisibility: true },
  });
  api.getSitesCapabilities.mockResolvedValue({ canCreate: false, allowedVisibilities: [] });
  api.setSiteVisibility.mockResolvedValue({ id: 'owned', visibility: 'public' });
});
async function run() {
  const command = new Command();
  registerSitesCommands(command);
  await command.parseAsync(['sites', 'visibility', 'owned', 'public', '--yes'], { from: 'user' });
}
it('publishes an owned existing site even when creation capability is unavailable', async () => {
  await run();
  expect(api.setSiteVisibility).toHaveBeenCalledWith('owned', 'public', 7);
  expect(api.getSitesCapabilities).not.toHaveBeenCalled();
});
it('does not mutate when the current Site permission denies visibility changes', async () => {
  api.getSite.mockResolvedValue({ visibility: 'private', permissions: { canChangeVisibility: false } });
  await expect(run()).rejects.toThrow('current access');
  expect(api.setSiteVisibility).not.toHaveBeenCalled();
});
it('propagates a stale-revision rejection from the server without retrying publication', async () => {
  api.setSiteVisibility.mockRejectedValue(new Error('Site changed'));
  await expect(run()).rejects.toThrow('Site changed');
  expect(api.setSiteVisibility).toHaveBeenCalledTimes(1);
});

describe('create', () => {
  let dir: string;
  let filePath: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfc-sites-create-'));
    filePath = path.join(dir, 'index.html');
    fs.writeFileSync(filePath, '<h1>hello</h1>');
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    api.createSite.mockResolvedValue({ id: 'new-site', visibility: 'public', permissions: {} });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });
  async function runCreate() {
    const command = new Command();
    registerSitesCommands(command);
    await command.parseAsync(['sites', 'create', filePath], { from: 'user' });
  }

  it('confirms with a default-credential message when no --visibility is given and the account defaults to public', async () => {
    api.getSitesCapabilities.mockResolvedValue({
      enabled: true,
      canCreate: true,
      allowedVisibilities: ['private', 'public'],
      defaultVisibility: 'public',
      upload: { maxFiles: 5, maxUploadBytes: 1_000_000, maxExtractedBytes: 1_000_000, allowedExtensions: ['html'] },
    });
    prompts.confirm.mockResolvedValue(true);
    await runCreate();
    expect(prompts.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('by default for your credential') }),
    );
    expect(api.createSite).toHaveBeenCalledTimes(1);
  });

  it('does not upload when the default-public confirmation is declined', async () => {
    api.getSitesCapabilities.mockResolvedValue({
      enabled: true,
      canCreate: true,
      allowedVisibilities: ['private', 'public'],
      defaultVisibility: 'public',
      upload: { maxFiles: 5, maxUploadBytes: 1_000_000, maxExtractedBytes: 1_000_000, allowedExtensions: ['html'] },
    });
    prompts.confirm.mockResolvedValue(false);
    await runCreate();
    expect(api.createSite).not.toHaveBeenCalled();
  });

  it('does not prompt when the account defaults to private', async () => {
    api.getSitesCapabilities.mockResolvedValue({
      enabled: true,
      canCreate: true,
      allowedVisibilities: ['private', 'public'],
      defaultVisibility: 'private',
      upload: { maxFiles: 5, maxUploadBytes: 1_000_000, maxExtractedBytes: 1_000_000, allowedExtensions: ['html'] },
    });
    await runCreate();
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(api.createSite).toHaveBeenCalledTimes(1);
  });
});

describe('restore, delete and list --deleted', () => {
  let stderr: MockInstance<typeof process.stderr.write>;
  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    stderr.mockRestore();
    ctxState.json = true;
  });
  async function runArgs(...args: string[]) {
    const command = new Command();
    registerSitesCommands(command);
    await command.parseAsync(['sites', ...args], { from: 'user' });
  }

  it('restores a deleted site using the revision from the deleted list', async () => {
    api.listSites.mockResolvedValue({
      items: [{ id: 'gone', accessRevision: 4, permissions: { canRestore: true } }],
    });
    api.restoreSite.mockResolvedValue({ id: 'gone', openUrl: 'https://x/gone', permissions: {} });
    await runArgs('restore', 'gone');
    expect(api.listSites).toHaveBeenCalledWith(expect.objectContaining({ view: 'deleted', q: 'gone' }));
    expect(api.restoreSite).toHaveBeenCalledWith('gone', 4);
    expect(api.getSite).not.toHaveBeenCalled();
  });

  it('fails when the site is not in the deleted list', async () => {
    api.listSites.mockResolvedValue({ items: [{ id: 'other', accessRevision: 1, permissions: { canRestore: true } }] });
    await expect(runArgs('restore', 'gone')).rejects.toThrow('no longer restorable');
    expect(api.restoreSite).not.toHaveBeenCalled();
  });

  it('does not restore when canRestore is false', async () => {
    api.listSites.mockResolvedValue({ items: [{ id: 'gone', accessRevision: 1, permissions: { canRestore: false } }] });
    await expect(runArgs('restore', 'gone')).rejects.toThrow('current access');
    expect(api.restoreSite).not.toHaveBeenCalled();
  });

  it('lists deleted sites with view=deleted and implies mine', async () => {
    api.listSites.mockResolvedValue({ items: [], pagination: undefined });
    await runArgs('list', '--deleted', '--mine');
    expect(api.listSites).toHaveBeenCalledWith(expect.objectContaining({ view: 'deleted' }));
  });

  it('shows the retention period with the deleted list', async () => {
    ctxState.json = false;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    api.getSitesCapabilities.mockResolvedValue({ deletedRetentionDays: 30 });
    api.listSites.mockResolvedValue({
      items: [
        {
          id: 'gone',
          name: 'Old plan',
          deletedAt: '2030-01-01T00:00:00.000Z',
          restorableUntil: '2030-01-31T00:00:00.000Z',
          permissions: { canRestore: true },
        },
      ],
    });
    await runArgs('list', '--deleted');
    const written = stdout.mock.calls.map(c => String(c[0])).join('');
    stdout.mockRestore();
    expect(written).toContain('Deleted sites are kept for 30 days, then permanently removed.');
    expect(written).toContain('lfc sites restore <id>');
  });

  it('still lists deleted sites when capabilities cannot be loaded', async () => {
    ctxState.json = false;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    api.getSitesCapabilities.mockRejectedValue(new Error('unavailable'));
    api.listSites.mockResolvedValue({ items: [] });
    await runArgs('list', '--deleted');
    const written = stdout.mock.calls.map(c => String(c[0])).join('');
    stdout.mockRestore();
    expect(written).toContain(
      "No recently deleted sites. Deleted sites can be restored until they're permanently removed.",
    );
  });

  it('rejects --deleted with --public', async () => {
    await expect(runArgs('list', '--deleted', '--public')).rejects.toThrow('cannot be combined');
    expect(api.listSites).not.toHaveBeenCalled();
  });

  it('only promises a restore window in the delete prompt when the server reports one', async () => {
    ctxState.json = false;
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    api.getSite.mockResolvedValue({ id: 'owned', accessRevision: 7, permissions: { canDelete: true } });
    api.deleteSite.mockResolvedValue({ id: 'owned', restorableUntil: null });
    prompts.confirm.mockResolvedValue(true);
    try {
      api.getSitesCapabilities.mockResolvedValue({ deletedRetentionDays: 30 });
      await runArgs('delete', 'owned');
      expect(prompts.confirm).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: expect.stringContaining('You can restore it for 30 days.') }),
      );
      api.getSitesCapabilities.mockRejectedValue(new Error('unavailable'));
      await runArgs('delete', 'owned');
      expect(prompts.confirm).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: 'Delete site owned? Its URL stops working immediately.' }),
      );
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
    }
  });

  it('tells the user how to restore after delete', async () => {
    ctxState.json = false;
    api.getSite.mockResolvedValue({ id: 'owned', accessRevision: 7, permissions: { canDelete: true } });
    api.deleteSite.mockResolvedValue({ id: 'owned', restorableUntil: '2030-01-01T00:00:00.000Z' });
    await runArgs('delete', 'owned', '--yes');
    expect(api.deleteSite).toHaveBeenCalledWith('owned', 7);
    const written = stderr.mock.calls.map(c => String(c[0])).join('');
    expect(written).toContain('lfc sites restore owned');
    expect(written).not.toMatch(/permanent/i);
  });
});
