import type { ListSitesView } from './generated/index.js';
import type { SitesCapabilities, SiteVisibility } from './types.js';

export function siteListView(opts: { mine?: boolean; public?: boolean; deleted?: boolean }): ListSitesView {
  if (opts.deleted) {
    if (opts.public) throw new Error('--deleted and --public cannot be combined.');
    return 'deleted';
  }
  if (opts.mine && opts.public) throw new Error('--mine and --public cannot be combined.');
  return opts.mine ? 'mine' : opts.public ? 'public' : 'all';
}
export function validateSiteVisibility(visibility: SiteVisibility | undefined, capabilities: SitesCapabilities): void {
  if (visibility && !capabilities.allowedVisibilities.includes(visibility))
    throw new Error(`Visibility ${visibility} is not supported for this credential. No files were uploaded.`);
}

export function describeRetention(days: number | undefined): string {
  if (days === undefined) return "Deleted sites can be restored until they're permanently removed.";
  if (days === 0) return 'Deleted sites are permanently removed at the next cleanup.';
  return `Deleted sites are kept for ${days} ${days === 1 ? 'day' : 'days'}, then permanently removed.`;
}
