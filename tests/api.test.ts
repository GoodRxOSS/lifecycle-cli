import { describe, expect, it } from 'vitest';

import { ApiClient, type ListResult } from '../src/lib/api.js';
import type { Profile } from '../src/lib/config.js';
import type { BuildListItem } from '../src/lib/types.js';

const PROFILE: Profile = { apiUrl: 'http://example.test', authEnabled: false };

function mk(uuid: string, pr: { fullName: string; pullRequestNumber?: number; branchName?: string } | null): BuildListItem {
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
    const { matches, truncated } = await client.resolveBuild({ repo: 'acme/repo', branch: 'z' }, { limit: 2, maxPages: 5 });
    expect(matches.map((m) => m.uuid)).toEqual(['c']);
    expect(truncated).toBe(false);
  });

  it('collects matches spread across multiple full pages', async () => {
    const client = clientWithPages([
      [mk('a', { fullName: 'acme/repo', pullRequestNumber: 7 }), mk('z', { fullName: 'other/repo', pullRequestNumber: 7 })],
      [mk('c', { fullName: 'acme/repo', pullRequestNumber: 7 })],
    ]);
    const { matches } = await client.resolveBuild({ repo: 'acme/repo', prNumber: 7 }, { limit: 2, maxPages: 5 });
    expect(matches.map((m) => m.uuid).sort()).toEqual(['a', 'c']);
  });

  it('flags truncated when the page cap is hit with full pages', async () => {
    const client = clientWithPages([
      [mk('a', { fullName: 'acme/repo', pullRequestNumber: 1 }), mk('b', { fullName: 'acme/repo', pullRequestNumber: 2 })],
      [mk('c', { fullName: 'acme/repo', pullRequestNumber: 3 }), mk('d', { fullName: 'acme/repo', pullRequestNumber: 4 })],
    ]);
    const { matches, truncated } = await client.resolveBuild({ repo: 'acme/repo', prNumber: 99 }, { limit: 2, maxPages: 2 });
    expect(matches).toEqual([]);
    expect(truncated).toBe(true);
  });

  it('handles an empty first page', async () => {
    const client = clientWithPages([[]]);
    const { matches, truncated } = await client.resolveBuild({ repo: 'acme/repo', prNumber: 1 }, { limit: 2, maxPages: 5 });
    expect(matches).toEqual([]);
    expect(truncated).toBe(false);
  });
});
