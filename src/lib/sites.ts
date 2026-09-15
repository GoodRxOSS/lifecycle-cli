import type { ListSitesView } from './generated/index.js';
import type { SitesCapabilities, SiteVisibility } from './types.js';

export function siteListView(opts: { mine?: boolean; public?: boolean }): ListSitesView {
  if (opts.mine && opts.public) throw new Error('--mine and --public cannot be combined.');
  return opts.mine ? 'mine' : opts.public ? 'public' : 'all';
}
export function validateSiteVisibility(visibility: SiteVisibility | undefined, capabilities: SitesCapabilities): void {
  if (visibility && !capabilities.allowedVisibilities.includes(visibility))
    throw new Error(`Visibility ${visibility} is not supported for this credential. No files were uploaded.`);
}
