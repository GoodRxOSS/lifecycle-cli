import { describe, expect, it } from 'vitest';

import { matchBuilds, parsePrUrl, parseSelector, pickBuild } from '../src/lib/resolve.js';
import type { BuildListItem } from '../src/lib/types.js';

function mk(partial: {
  uuid: string;
  status?: string;
  updatedAt?: string;
  pr?: { fullName?: string; pullRequestNumber?: number; branchName?: string } | null;
}): BuildListItem {
  return {
    uuid: partial.uuid,
    status: partial.status ?? 'deployed',
    namespace: `env-${partial.uuid}`,
    updatedAt: partial.updatedAt,
    pullRequest:
      partial.pr === null
        ? null
        : {
            id: 1,
            title: 't',
            githubLogin: 'octocat',
            status: 'open',
            labels: [],
            fullName: partial.pr?.fullName ?? 'acme/storefront',
            pullRequestNumber: partial.pr?.pullRequestNumber ?? 1,
            branchName: partial.pr?.branchName ?? 'main',
          },
  } as BuildListItem;
}

describe('parsePrUrl', () => {
  it('parses a plain PR URL', () => {
    expect(parsePrUrl('https://github.com/acme/storefront/pull/123')).toEqual({
      repo: 'acme/storefront',
      prNumber: 123,
    });
  });

  it('tolerates trailing path, fragment and query', () => {
    expect(parsePrUrl('https://github.com/acme/storefront/pull/123/files?w=1#r99')).toEqual({
      repo: 'acme/storefront',
      prNumber: 123,
    });
  });

  it('strips a .git suffix on the repo', () => {
    expect(parsePrUrl('https://github.com/acme/storefront.git/pull/7')).toEqual({
      repo: 'acme/storefront',
      prNumber: 7,
    });
  });

  it('returns null for non-PR / unsupported inputs', () => {
    expect(parsePrUrl('acme/storefront#123')).toBeNull();
    expect(parsePrUrl('git@github.com:acme/storefront.git')).toBeNull();
    expect(parsePrUrl('https://gitlab.com/acme/storefront/pull/1')).toBeNull();
    expect(parsePrUrl('just-a-branch')).toBeNull();
  });

  it('does not match github.com look-alike hosts', () => {
    expect(parsePrUrl('https://notgithub.com/acme/storefront/pull/1')).toBeNull();
    expect(parsePrUrl('https://github.com.evil.example/acme/storefront/pull/1')).toBeNull();
  });
});

describe('parseSelector', () => {
  it('resolves a self-contained PR URL without --repo', () => {
    expect(parseSelector({ pr: 'https://github.com/acme/storefront/pull/9' })).toEqual({
      repo: 'acme/storefront',
      prNumber: 9,
    });
  });

  it('resolves a bare PR number with --repo', () => {
    expect(parseSelector({ pr: '42', repo: 'acme/storefront' })).toEqual({
      repo: 'acme/storefront',
      prNumber: 42,
    });
  });

  it('resolves a branch with --repo', () => {
    expect(parseSelector({ branch: 'feat/x', repo: 'acme/storefront' })).toEqual({
      repo: 'acme/storefront',
      branch: 'feat/x',
    });
  });

  it('rejects neither / both selectors', () => {
    expect(() => parseSelector({})).toThrow(/exactly one/);
    expect(() => parseSelector({ pr: '1', branch: 'b', repo: 'a/b' })).toThrow(/exactly one/);
  });

  it('requires --repo for a bare number or a branch', () => {
    expect(() => parseSelector({ pr: '42' })).toThrow(/--repo/);
    expect(() => parseSelector({ branch: 'feat/x' })).toThrow(/--repo/);
  });

  it('rejects an invalid --repo and a non-URL non-number --pr', () => {
    expect(() => parseSelector({ pr: '42', repo: 'not-a-repo' })).toThrow(/org\/repo/);
    expect(() => parseSelector({ pr: 'garbage', repo: 'a/b' })).toThrow(/PR URL or a PR number/);
  });

  it('rejects a --repo that conflicts with the PR URL', () => {
    expect(() => parseSelector({ pr: 'https://github.com/acme/storefront/pull/9', repo: 'other/repo' })).toThrow(
      /conflicts/
    );
  });
});

describe('matchBuilds', () => {
  const builds = [
    mk({ uuid: 'a', pr: { fullName: 'acme/storefront', pullRequestNumber: 10, branchName: 'feat/x' } }),
    mk({ uuid: 'b', pr: { fullName: 'acme/storefront', pullRequestNumber: 11, branchName: 'feat/y' } }),
    mk({ uuid: 'c', pr: { fullName: 'other/repo', pullRequestNumber: 10, branchName: 'feat/x' } }),
    mk({ uuid: 'd', pr: null }),
  ];

  it('matches on repo + PR number only', () => {
    expect(matchBuilds(builds, { repo: 'acme/storefront', prNumber: 10 }).map((b) => b.uuid)).toEqual(['a']);
  });

  it('matches on repo + branch only', () => {
    expect(matchBuilds(builds, { repo: 'acme/storefront', branch: 'feat/y' }).map((b) => b.uuid)).toEqual(['b']);
  });

  it('is case-insensitive on repo', () => {
    expect(matchBuilds(builds, { repo: 'ACME/StoreFront', prNumber: 11 }).map((b) => b.uuid)).toEqual(['b']);
  });

  it('never matches a build without a pullRequest', () => {
    expect(matchBuilds([mk({ uuid: 'd', pr: null })], { repo: 'acme/storefront', prNumber: 1 })).toEqual([]);
  });

  it('does not match the wrong repo even when the number/branch coincide', () => {
    expect(matchBuilds(builds, { repo: 'acme/storefront', branch: 'feat/x' }).map((b) => b.uuid)).toEqual(['a']);
  });
});

describe('pickBuild', () => {
  it('returns undefined for no matches', () => {
    expect(pickBuild([])).toBeUndefined();
  });

  it('prefers a live build over a torn-down one', () => {
    const picked = pickBuild([
      mk({ uuid: 'old-live', status: 'deployed', updatedAt: '2026-01-01T00:00:00Z' }),
      mk({ uuid: 'new-dead', status: 'torn_down', updatedAt: '2026-06-01T00:00:00Z' }),
    ]);
    expect(picked?.uuid).toBe('old-live');
  });

  it('picks the most recent among live builds', () => {
    const picked = pickBuild([
      mk({ uuid: 'older', updatedAt: '2026-01-01T00:00:00Z' }),
      mk({ uuid: 'newer', updatedAt: '2026-06-01T00:00:00Z' }),
    ]);
    expect(picked?.uuid).toBe('newer');
  });

  it('sorts builds with missing/invalid dates last', () => {
    const picked = pickBuild([mk({ uuid: 'nodate' }), mk({ uuid: 'dated', updatedAt: '2026-01-01T00:00:00Z' })]);
    expect(picked?.uuid).toBe('dated');
  });
});
