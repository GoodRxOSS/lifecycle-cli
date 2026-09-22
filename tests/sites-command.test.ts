import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSitesCommands } from '../src/commands/sites.js';

const api = vi.hoisted(() => ({
  getSite: vi.fn(),
  getSitesCapabilities: vi.fn(),
  setSiteVisibility: vi.fn(),
  createSite: vi.fn(),
}));
const prompts = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../src/lib/context.js', () => ({
  runAction:
    (action: (ctx: unknown, ...args: unknown[]) => Promise<void>) =>
    (...args: unknown[]) =>
      action({ api, json: true }, ...args.slice(0, -1)),
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
