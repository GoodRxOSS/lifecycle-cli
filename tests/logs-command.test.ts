import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerPodsCommands } from '../src/commands/pods.js';
import { registerServicesCommands } from '../src/commands/services.js';

const api = vi.hoisted(() => ({
  baseUrl: 'https://api.example.test',
  getBuild: vi.fn(),
  listEnvironmentPods: vi.fn(),
  listServicePods: vi.fn(),
  listBuildJobs: vi.fn(),
  listDeployJobs: vi.fn(),
  getJobLogInfo: vi.fn(),
  createLogStreamTicket: vi.fn(),
}));
const streamPodLogs = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/context.js', () => ({
  runAction:
    (action: (ctx: unknown, ...args: unknown[]) => Promise<void>) =>
    (...args: unknown[]) =>
      action({ api, json: false, quiet: true }, ...args.slice(0, -1)),
}));
vi.mock('../src/lib/logs.js', () => ({ streamPodLogs }));

const TICKET = { ticket: 'lfclt_v1.ticket', maxAgeSeconds: 300 };
let originalIsTTY: boolean | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  originalIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  api.createLogStreamTicket.mockResolvedValue(TICKET);
  streamPodLogs.mockResolvedValue(undefined);
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
});

function mintedBeforeStreaming(): boolean {
  return api.createLogStreamTicket.mock.invocationCallOrder[0]! < streamPodLogs.mock.invocationCallOrder[0]!;
}

describe('pods logs', () => {
  async function run(...args: string[]) {
    const command = new Command();
    registerPodsCommands(command);
    await command.parseAsync(['pods', 'logs', ...args], { from: 'user' });
  }

  beforeEach(() => {
    api.listEnvironmentPods.mockResolvedValue([
      { podName: 'web-abc', status: 'Running', containers: [{ name: 'init-db' }, { name: 'web' }] },
    ]);
  });

  it('mints a ticket for the chosen pod and container before streaming', async () => {
    await run('build-1', 'web-abc', '-c', 'web', '-f', '--tail', '50', '--timestamps');
    expect(api.createLogStreamTicket).toHaveBeenCalledWith('build-1', 'web-abc', 'web');
    expect(streamPodLogs).toHaveBeenCalledWith(
      'https://api.example.test',
      {
        ticket: 'lfclt_v1.ticket',
        podName: 'web-abc',
        containerName: 'web',
        follow: true,
        tailLines: 50,
        timestamps: true,
      },
      { quiet: true },
    );
    expect(mintedBeforeStreaming()).toBe(true);
  });

  it('no longer loads the build to learn its namespace', async () => {
    await run('build-1', 'web-abc', '-c', 'web');
    expect(api.getBuild).not.toHaveBeenCalled();
    expect(streamPodLogs.mock.calls[0]![1]).not.toHaveProperty('namespace');
  });

  it('defaults to the main container when none is given', async () => {
    await run('build-1', 'web-abc');
    expect(api.createLogStreamTicket).toHaveBeenCalledWith('build-1', 'web-abc', 'web');
  });

  it('rejects an invalid --tail before asking for a ticket', async () => {
    await expect(run('build-1', 'web-abc', '--tail', 'lots')).rejects.toThrow('Invalid --tail value');
    expect(api.createLogStreamTicket).not.toHaveBeenCalled();
  });

  it('does not open the stream when the ticket is refused', async () => {
    api.createLogStreamTicket.mockRejectedValue(new Error("You don't have access to this environment's logs."));
    await expect(run('build-1', 'web-abc', '-c', 'web')).rejects.toThrow("don't have access");
    expect(streamPodLogs).not.toHaveBeenCalled();
  });
});

describe('services logs', () => {
  const liveInfo = {
    status: 'Running',
    streamingRequired: true,
    podName: 'web-build-job-xyz',
    websocket: {
      endpoint: '/api/logs/stream',
      parameters: { podName: 'web-build-job-xyz', namespace: 'env-build-1', follow: true, timestamps: false },
    },
    containers: [
      { name: '[init] clone', state: 'Terminated' },
      { name: 'main', state: 'Running' },
    ],
  };

  async function run(...args: string[]) {
    const command = new Command();
    registerServicesCommands(command);
    await command.parseAsync(['services', 'logs', ...args], { from: 'user' });
  }

  beforeEach(() => {
    api.listBuildJobs.mockResolvedValue([
      { jobName: 'web-build-1', startedAt: '2026-01-01T00:00:00Z' },
      { jobName: 'web-build-2', startedAt: '2026-02-01T00:00:00Z' },
    ]);
    api.listDeployJobs.mockResolvedValue([{ jobName: 'web-deploy-1', startedAt: '2026-01-01T00:00:00Z' }]);
    api.getJobLogInfo.mockResolvedValue(liveInfo);
  });

  it('mints a ticket for the job pod and its main container before streaming', async () => {
    await run('build-1', 'web', '-f');
    expect(api.getJobLogInfo).toHaveBeenCalledWith('build-1', 'web', 'web-build-2', 'build');
    expect(api.createLogStreamTicket).toHaveBeenCalledWith('build-1', 'web-build-job-xyz', 'main');
    expect(streamPodLogs).toHaveBeenCalledWith(
      'https://api.example.test',
      {
        ticket: 'lfclt_v1.ticket',
        podName: 'web-build-job-xyz',
        containerName: 'main',
        follow: true,
        tailLines: 500,
        timestamps: false,
      },
      { quiet: true },
    );
    expect(mintedBeforeStreaming()).toBe(true);
  });

  it('streams the deploy job named with --job', async () => {
    await run('build-1', 'web', '--deploy', '--job', 'web-deploy-1');
    expect(api.getJobLogInfo).toHaveBeenCalledWith('build-1', 'web', 'web-deploy-1', 'deploy');
    expect(api.createLogStreamTicket).toHaveBeenCalledWith('build-1', 'web-build-job-xyz', 'main');
    expect(streamPodLogs).toHaveBeenCalledWith(
      'https://api.example.test',
      expect.objectContaining({ ticket: 'lfclt_v1.ticket', follow: false }),
      { quiet: true },
    );
  });

  it('prints archived logs without asking for a ticket', async () => {
    api.getJobLogInfo.mockResolvedValue({ status: 'Archived', streamingRequired: false, archivedLogs: 'done\n' });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await run('build-1', 'web');
    stdout.mockRestore();
    expect(api.createLogStreamTicket).not.toHaveBeenCalled();
    expect(streamPodLogs).not.toHaveBeenCalled();
  });

  it('does not open the stream when the ticket is refused', async () => {
    api.createLogStreamTicket.mockRejectedValue(new Error('That pod is no longer running.'));
    await expect(run('build-1', 'web')).rejects.toThrow('no longer running');
    expect(streamPodLogs).not.toHaveBeenCalled();
  });
});
