import { Command } from 'commander';
import { beforeEach, expect, it, vi } from 'vitest';

import { registerSitesCommands } from '../src/commands/sites.js';

const api = vi.hoisted(() => ({ getSite: vi.fn(), getSitesCapabilities: vi.fn(), setSiteVisibility: vi.fn() }));
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
