import type { BuildListItem } from './types.js';

/** A normalized build selector: repo plus exactly one of prNumber or branch. */
export interface Selector {
  repo: string;
  prNumber?: number;
  branch?: string;
}

/** Raw CLI flags for `builds find`. */
export interface SelectorInput {
  pr?: string;
  branch?: string;
  repo?: string;
}

// Anchor github.com to a host boundary (start or after "//") so look-alikes
// like "notgithub.com/..." don't match.
const PR_URL_RE = /(?:^|\/\/)(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)\/pull\/(\d+)/i;
const REPO_RE = /^[^/\s]+\/[^/\s]+$/;
const TORN_DOWN = new Set(['torn_down', 'deleted']);

function normalizeRepo(repo: string): string {
  return repo
    .trim()
    .replace(/\.git$/i, '')
    .toLowerCase();
}

function assertRepo(repo: string): string {
  const r = repo.trim();
  if (!REPO_RE.test(r)) throw new Error(`--repo must be in the form org/repo (got "${repo}")`);
  return r;
}

/**
 * Parse a GitHub PR URL into {repo, prNumber}. Tolerates trailing path segments
 * (/files, /commits), fragments and query strings. Returns null if not a PR URL.
 * Punts (returns null): SSH remotes, `org/repo#123` shorthand, non-github hosts.
 */
export function parsePrUrl(input: string): { repo: string; prNumber: number } | null {
  const cleaned = input.trim().split('#')[0]?.split('?')[0] ?? '';
  const m = PR_URL_RE.exec(cleaned);
  if (!m) return null;
  const [, org, name, num] = m;
  if (!org || !name || !num) return null;
  const repo = `${org}/${name.replace(/\.git$/i, '')}`;
  return { repo, prNumber: Number(num) };
}

/**
 * Normalize `builds find` flags into a Selector, or throw a friendly error.
 * Rules: exactly one of --pr / --branch; a PR URL is self-contained; a bare PR
 * number or a branch requires --repo.
 */
export function parseSelector(input: SelectorInput): Selector {
  const hasPr = Boolean(input.pr && input.pr.trim());
  const hasBranch = Boolean(input.branch && input.branch.trim());
  if (hasPr === hasBranch) {
    throw new Error('Provide exactly one of --pr or --branch');
  }

  if (hasPr) {
    const raw = input.pr!.trim();
    const url = parsePrUrl(raw);
    if (url) {
      if (input.repo && normalizeRepo(input.repo) !== normalizeRepo(url.repo)) {
        throw new Error(`--repo "${input.repo}" conflicts with the repo in the PR URL (${url.repo})`);
      }
      return { repo: url.repo, prNumber: url.prNumber };
    }
    if (!/^\d+$/.test(raw)) {
      throw new Error(`--pr must be a GitHub PR URL or a PR number (got "${raw}")`);
    }
    if (!input.repo) throw new Error('--pr <number> requires --repo <org/repo> (or pass a full PR URL)');
    return { repo: assertRepo(input.repo), prNumber: Number(raw) };
  }

  if (!input.repo) throw new Error('--branch requires --repo <org/repo>');
  return { repo: assertRepo(input.repo), branch: input.branch!.trim() };
}

/**
 * Filter builds to those matching the selector: exact repo (case-insensitive)
 * AND the single provided key (prNumber XOR branch). Builds without a pullRequest
 * never match.
 */
export function matchBuilds(builds: BuildListItem[], selector: Selector): BuildListItem[] {
  const repo = normalizeRepo(selector.repo);
  return builds.filter(b => {
    const pr = b.pullRequest;
    if (!pr || !pr.fullName) return false;
    if (pr.fullName.toLowerCase() !== repo) return false;
    // repo is compared case-insensitively (GitHub owner/name are); branch is
    // compared exactly, since git branch names are case-sensitive.
    if (selector.prNumber !== undefined) return pr.pullRequestNumber === selector.prNumber;
    return pr.branchName === selector.branch;
  });
}

function updatedAtMs(b: BuildListItem): number {
  const n = Date.parse(b.updatedAt ?? '');
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Pick which matched build to report: prefer a live one over a torn-down one,
 * then the most recently updated. Returns undefined for an empty list.
 */
export function pickBuild(matches: BuildListItem[]): BuildListItem | undefined {
  if (matches.length === 0) return undefined;
  return [...matches].sort((a, b) => {
    const aTd = TORN_DOWN.has((a.status ?? '').toLowerCase()) ? 1 : 0;
    const bTd = TORN_DOWN.has((b.status ?? '').toLowerCase()) ? 1 : 0;
    if (aTd !== bTd) return aTd - bTd;
    return updatedAtMs(b) - updatedAtMs(a);
  })[0];
}
