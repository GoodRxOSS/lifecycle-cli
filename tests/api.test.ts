import { afterEach, describe, expect, it, vi } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { ApiClient, ApiError, type ListResult } from '../src/lib/api.js';
import type { Profile } from '../src/lib/config.js';
import type { BuildListItem } from '../src/lib/types.js';

vi.mock('../src/lib/auth.js', () => ({ getAccessToken: vi.fn(async () => 'lfc_pat_test') }));

const PROFILE: Profile = { apiUrl: 'http://example.test', authEnabled: false };
const KEY_PROFILE: Profile = { apiUrl: 'https://api.example.test', authEnabled: true };

function mk(
  uuid: string,
  pr: { fullName: string; pullRequestNumber?: number; branchName?: string } | null,
): BuildListItem {
  return {
    uuid,
    status: 'deployed',
    namespace: `env-${uuid}`,
    updatedAt: '2026-01-01T00:00:00Z',
    pullRequest:
      pr === null
        ? null
        : {
            id: 1,
            title: 't',
            githubLogin: 'x',
            status: 'open',
            labels: [],
            fullName: pr.fullName,
            pullRequestNumber: pr.pullRequestNumber ?? 1,
            branchName: pr.branchName ?? 'main',
          },
  } as BuildListItem;
}

/** An ApiClient whose listBuilds is stubbed to serve fixed pages. */
function clientWithPages(pages: BuildListItem[][]): ApiClient {
  const client = new ApiClient('test', PROFILE);
  client.listBuilds = async ({ page = 1 }): Promise<ListResult<BuildListItem>> => ({
    items: pages[page - 1] ?? [],
    pagination: { page } as never,
  });
  return client;
}

describe('ApiClient.resolveBuild', () => {
  it('stops on a short page and returns matches (truncated=false)', async () => {
    const client = clientWithPages([
      [mk('a', { fullName: 'acme/repo', branchName: 'x' }), mk('b', { fullName: 'acme/repo', branchName: 'y' })],
      [mk('c', { fullName: 'acme/repo', branchName: 'z' })],
    ]);
    const { matches, truncated } = await client.resolveBuild(
      { repo: 'acme/repo', branch: 'z' },
      { limit: 2, maxPages: 5 },
    );
    expect(matches.map(m => m.uuid)).toEqual(['c']);
    expect(truncated).toBe(false);
  });

  it('collects matches spread across multiple full pages', async () => {
    const client = clientWithPages([
      [
        mk('a', { fullName: 'acme/repo', pullRequestNumber: 7 }),
        mk('z', { fullName: 'other/repo', pullRequestNumber: 7 }),
      ],
      [mk('c', { fullName: 'acme/repo', pullRequestNumber: 7 })],
    ]);
    const { matches } = await client.resolveBuild({ repo: 'acme/repo', prNumber: 7 }, { limit: 2, maxPages: 5 });
    expect(matches.map(m => m.uuid).sort()).toEqual(['a', 'c']);
  });

  it('flags truncated when the page cap is hit with full pages', async () => {
    const client = clientWithPages([
      [
        mk('a', { fullName: 'acme/repo', pullRequestNumber: 1 }),
        mk('b', { fullName: 'acme/repo', pullRequestNumber: 2 }),
      ],
      [
        mk('c', { fullName: 'acme/repo', pullRequestNumber: 3 }),
        mk('d', { fullName: 'acme/repo', pullRequestNumber: 4 }),
      ],
    ]);
    const { matches, truncated } = await client.resolveBuild(
      { repo: 'acme/repo', prNumber: 99 },
      { limit: 2, maxPages: 2 },
    );
    expect(matches).toEqual([]);
    expect(truncated).toBe(true);
  });

  it('handles an empty first page', async () => {
    const client = clientWithPages([[]]);
    const { matches, truncated } = await client.resolveBuild(
      { repo: 'acme/repo', prNumber: 1 },
      { limit: 2, maxPages: 5 },
    );
    expect(matches).toEqual([]);
    expect(truncated).toBe(false);
  });
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ApiClient.createLogStreamTicket', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the build, pod and container with the API key and returns the ticket', async () => {
    const fetchMock = stubFetch(200, {
      request_id: 'r1',
      data: { ticket: 'lfclt_v1.abc', maxAgeSeconds: 300 },
      error: null,
    });
    const client = new ApiClient('test', KEY_PROFILE);
    await expect(client.createLogStreamTicket('build-1', 'web-abc', '[init] clone')).resolves.toEqual({
      ticket: 'lfclt_v1.abc',
      maxAgeSeconds: 300,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.example.test/api/v2/logs/stream-tickets');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer lfc_pat_test',
      'Content-Type': 'application/json',
      'User-Agent': `lifecycle-cli/${pkg.version}`,
    });
    expect(JSON.parse(String(init.body))).toEqual({
      buildUuid: 'build-1',
      podName: 'web-abc',
      containerName: '[init] clone',
    });
  });

  it.each([
    [403, 'forbidden_scope', "You do not have access to this environment's logs."],
    [403, 'forbidden_repository', "You do not have access to this environment's logs."],
    [404, 'log_stream_pod_not_found', 'That pod is no longer running.'],
    [404, 'log_stream_container_not_found', 'That container is no longer on the pod.'],
  ])('explains a %i %s in plain language', async (status, code, message) => {
    stubFetch(status, { request_id: 'r2', data: null, error: { message: 'server wording', code } });
    const client = new ApiClient('test', KEY_PROFILE);
    const err = await client.createLogStreamTicket('build-1', 'web-abc', 'web').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err as ApiError).toMatchObject({ status, code, requestId: 'r2' });
    expect((err as ApiError).message).toBe(message);
  });

  it('keeps the server message for other errors', async () => {
    stubFetch(404, {
      request_id: 'r3',
      data: null,
      error: { message: 'Environment not found.', code: 'environment_not_found' },
    });
    const client = new ApiClient('test', KEY_PROFILE);
    const err = await client.createLogStreamTicket('build-1', 'web-abc', 'web').catch((e: unknown) => e);
    expect(err as ApiError).toMatchObject({ status: 404, code: 'environment_not_found' });
    expect((err as ApiError).message).toBe('Environment not found.');
  });

  it('fails plainly when the response carries no ticket', async () => {
    stubFetch(200, { request_id: 'r4', data: {}, error: null });
    const client = new ApiClient('test', KEY_PROFILE);
    await expect(client.createLogStreamTicket('build-1', 'web-abc', 'web')).rejects.toThrow(
      'Could not start the log stream.',
    );
  });

  it.each([404, 405])(
    'explains an unavailable ticket route (%i) without falling back to insecure logs',
    async status => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('<html>Not found</html>', { status }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new ApiClient('test', KEY_PROFILE);
      await expect(client.createLogStreamTicket('build-1', 'web-abc', 'web')).rejects.toMatchObject({
        status,
        code: 'log_stream_api_incompatible',
        message: expect.stringContaining('install an API version that supports log tickets'),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403])('preserves authentication failure %i without a compatibility fallback', async status => {
    const fetchMock = stubFetch(status, {
      request_id: 'denied',
      data: null,
      error: { message: 'Access denied.', code: 'access_denied' },
    });
    const client = new ApiClient('test', KEY_PROFILE);
    await expect(client.createLogStreamTicket('build-1', 'web-abc', 'web')).rejects.toMatchObject({
      status,
      code: 'access_denied',
      message: 'Access denied.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(status === 401 ? 2 : 1);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toBe('https://api.example.test/api/v2/logs/stream-tickets');
    }
  });
});
