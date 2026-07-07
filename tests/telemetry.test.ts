import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, saveConfig, saveTokens } from '../src/lib/config.js';
import { runAction, type Ctx } from '../src/lib/context.js';
import {
  commandPath,
  explicitFlags,
  getInstallId,
  isTelemetryDisabled,
  reportInvocation,
} from '../src/lib/telemetry.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfc-telemetry-test-'));
  process.env.LFC_CONFIG_DIR = dir;
  delete process.env.LFC_TELEMETRY_DISABLED;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.LFC_CONFIG_DIR;
  delete process.env.LFC_TELEMETRY_DISABLED;
  vi.unstubAllGlobals();
});

async function parsedCommand(argv: string[]): Promise<Command> {
  const program = new Command().name('lfc').option('--json').option('--profile <name>');
  let captured: Command | undefined;
  program
    .command('builds')
    .command('list')
    .option('--limit <n>', 'page size', '20')
    .action((_opts: unknown, cmd: Command) => {
      captured = cmd;
    });
  await program.parseAsync(argv, { from: 'user' });
  if (!captured) throw new Error('command did not run');
  return captured;
}

function fakeCtx(profile?: Partial<Ctx['profile']>): Ctx {
  return {
    profileName: 'default',
    profile: { apiUrl: 'https://lifecycle.example.com', authEnabled: false, ...profile },
    api: { baseUrl: 'https://lifecycle.example.com' },
  } as unknown as Ctx;
}

describe('isTelemetryDisabled', () => {
  it('is enabled by default and for falsy-looking values', () => {
    expect(isTelemetryDisabled(undefined)).toBe(false);
    expect(isTelemetryDisabled('')).toBe(false);
    expect(isTelemetryDisabled('0')).toBe(false);
    expect(isTelemetryDisabled('false')).toBe(false);
    expect(isTelemetryDisabled('FALSE')).toBe(false);
  });

  it('is disabled for any truthy value', () => {
    expect(isTelemetryDisabled('1')).toBe(true);
    expect(isTelemetryDisabled('true')).toBe(true);
    expect(isTelemetryDisabled('yes')).toBe(true);
  });
});

describe('command metadata', () => {
  it('joins the subcommand path without the program name', async () => {
    const cmd = await parsedCommand(['builds', 'list']);
    expect(commandPath(cmd)).toBe('builds list');
  });

  it('collects only flags explicitly passed on the CLI, across the command chain', async () => {
    const cmd = await parsedCommand(['--json', 'builds', 'list', '--limit', '5']);
    expect(explicitFlags(cmd).sort()).toEqual(['--json', '--limit']);
  });

  it('does not report defaulted or unset flags', async () => {
    const cmd = await parsedCommand(['builds', 'list']);
    expect(explicitFlags(cmd)).toEqual([]);
  });
});

describe('getInstallId', () => {
  it('generates a UUID once and persists it in the config file', () => {
    const first = getInstallId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getInstallId()).toBe(first);
    expect(loadConfig().installId).toBe(first);
  });

  it('keeps existing profiles intact when persisting the id', () => {
    saveConfig({
      currentProfile: 'staging',
      profiles: { staging: { apiUrl: 'https://staging.example.com', authEnabled: false } },
    });
    const id = getInstallId();
    const config = loadConfig();
    expect(config.installId).toBe(id);
    expect(config.currentProfile).toBe('staging');
    expect(config.profiles.staging).toBeDefined();
  });
});

describe('reportInvocation', () => {
  it('POSTs one event with names-only payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const cmd = await parsedCommand(['builds', 'list', '--limit', '5']);

    await reportInvocation(fakeCtx(), cmd, 123.6, { status: 'success', exitCode: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://lifecycle.example.com/api/v2/telemetry/events');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      source: 'cli',
      event: 'builds list',
      attributes: { flags: ['--limit'] },
      durationMs: 124,
      status: 'success',
      exitCode: 0,
      errorClass: null,
      platform: process.platform,
    });
    expect(body.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.clientVersion).toBeTruthy();
    expect(Object.keys(body)).not.toContain('args');
  });

  it('sends error details on failure without message text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const cmd = await parsedCommand(['builds', 'list']);

    await reportInvocation(fakeCtx(), cmd, 50, {
      status: 'error',
      exitCode: 3,
      errorClass: 'ApiError',
      errorHttpStatus: 404,
      errorCode: 'not_found',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      status: 'error',
      exitCode: 3,
      errorClass: 'ApiError',
      errorHttpStatus: 404,
      errorCode: 'not_found',
    });
  });

  it('sends nothing when LFC_TELEMETRY_DISABLED is truthy', async () => {
    process.env.LFC_TELEMETRY_DISABLED = '1';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cmd = await parsedCommand(['builds', 'list']);

    await reportInvocation(fakeCtx(), cmd, 10, { status: 'success', exitCode: 0 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when the command never built a context', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cmd = await parsedCommand(['builds', 'list']);

    await reportInvocation(undefined, cmd, 10, { status: 'error', exitCode: 1 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips silently when auth is enabled but the user is logged out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cmd = await parsedCommand(['builds', 'list']);
    const ctx = fakeCtx({
      authEnabled: true,
      keycloak: { issuer: 'https://kc.example.com/realms/lifecycle', clientId: 'lifecycle-cli' },
    });

    await expect(reportInvocation(ctx, cmd, 10, { status: 'success', exitCode: 0 })).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attaches a cached valid token without refreshing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    saveTokens('default', { accessToken: 'cached-token', expiresAt: Date.now() + 60_000 });
    const cmd = await parsedCommand(['builds', 'list']);
    const ctx = fakeCtx({
      authEnabled: true,
      keycloak: { issuer: 'https://kc.example.com/realms/lifecycle', clientId: 'lifecycle-cli' },
    });

    await reportInvocation(ctx, cmd, 10, { status: 'success', exitCode: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cached-token');
  });

  it('skips silently when the only cached token is expired (never refreshes)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    saveTokens('default', { accessToken: 'stale-token', expiresAt: Date.now() - 1_000 });
    const cmd = await parsedCommand(['builds', 'list']);
    const ctx = fakeCtx({
      authEnabled: true,
      keycloak: { issuer: 'https://kc.example.com/realms/lifecycle', clientId: 'lifecycle-cli' },
    });

    await reportInvocation(ctx, cmd, 10, { status: 'success', exitCode: 0 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const cmd = await parsedCommand(['builds', 'list']);

    await expect(reportInvocation(fakeCtx(), cmd, 10, { status: 'success', exitCode: 0 })).resolves.toBeUndefined();
  });
});

describe('runAction telemetry outcome', () => {
  async function runWrapped(handler: (ctx: Ctx) => Promise<void>) {
    saveConfig({
      currentProfile: 'default',
      profiles: { default: { apiUrl: 'https://lifecycle.example.com', authEnabled: false } },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    process.exitCode = 0;
    const program = new Command().name('lfc').option('--json').option('--profile <name>');
    program.command('demo').action(runAction(handler));
    await program.parseAsync(['demo'], { from: 'user' });
    return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
  }

  it('reports error when a command sets process.exitCode without throwing', async () => {
    const prev = process.exitCode;
    try {
      const [body] = await runWrapped(async () => {
        process.exitCode = 2;
      });
      expect(body).toMatchObject({ status: 'error', exitCode: 2 });
      expect(body.errorClass).toBeNull();
    } finally {
      process.exitCode = prev;
    }
  });

  it('reports success with exit 0 for a clean command', async () => {
    const prev = process.exitCode;
    try {
      const [body] = await runWrapped(async () => {});
      expect(body).toMatchObject({ status: 'success', exitCode: 0 });
    } finally {
      process.exitCode = prev;
    }
  });
});
