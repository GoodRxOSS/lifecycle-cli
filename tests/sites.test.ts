import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../src/lib/api.js';
import { siteListView, validateSiteVisibility } from '../src/lib/sites.js';
import type { SitesCapabilities } from '../src/lib/types.js';

vi.mock('../src/lib/auth.js', () => ({ getAccessToken: vi.fn(async () => 'lfc_test_personal_key') }));
const client = new ApiClient('fixture', { apiUrl: 'https://example.test', authEnabled: true });
const capabilities: SitesCapabilities = {
  enabled: true,
  canCreate: true,
  defaultVisibility: 'public',
  allowedVisibilities: ['public'],
  upload: { maxUploadBytes: 100, maxExtractedBytes: 100, maxFiles: 3, allowedExtensions: ['html'] },
};
afterEach(() => vi.unstubAllGlobals());
function mockResponse(data: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ request_id: 'test', data, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
describe('Sites V1 contracts', () => {
  it('uses a principal authenticated capabilities route, never legacy config cache', async () => {
    const fetchMock = mockResponse(capabilities);
    expect(await client.getSitesCapabilities()).toEqual(capabilities);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/api/v2/sites/capabilities');
    expect(options.headers).toEqual({ Authorization: 'Bearer lfc_test_personal_key' });
  });
  it('maps mine to server identity instead of requiring email', async () => {
    const fetchMock = mockResponse({ sites: [] });
    await client.listSites({ view: siteListView({ mine: true }), q: 'report & notes', page: 3, limit: 50 });
    const url = fetchMock.mock.calls[0]![0] as unknown as URL;
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'mine', q: 'report & notes', page: '3', limit: '50' });
  });
  it('rejects contradictory list filters', () =>
    expect(() => siteListView({ mine: true, public: true })).toThrow('cannot be combined'));
  it('allows omitted visibility to use the server credential default and rejects unsupported private requests', () => {
    expect(() => validateSiteVisibility(undefined, capabilities)).not.toThrow();
    expect(() => validateSiteVisibility('private', capabilities)).toThrow('No files were uploaded');
  });
  it('sends visibility preconditions and keeps the site locator escaped', async () => {
    const fetchMock = mockResponse({ site: { id: 'test' } });
    await client.setSiteVisibility('test/id', 'private', 7);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/api/v2/sites/test%2Fid/access');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(String(options.body))).toEqual({ visibility: 'private', expectedAccessRevision: 7 });
  });
  it('preserves server errors such as stale visibility conflicts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Access changed', code: 'stale_revision' }, data: null }), {
            status: 409,
          }),
      ),
    );
    await expect(client.setSiteVisibility('test', 'public', 1)).rejects.toMatchObject({
      status: 409,
      code: 'stale_revision',
    });
  });
  it('sends mutation revisions on delete and extend', async () => {
    const fetchMock = mockResponse({ site: { id: 'test' } });
    await client.deleteSite('test', 8);
    await client.extendSite('test', 9);
    expect((fetchMock.mock.calls[0]![0] as unknown as URL).searchParams.get('expectedAccessRevision')).toBe('8');
    expect((fetchMock.mock.calls[1]![0] as unknown as URL).searchParams.get('expectedAccessRevision')).toBe('9');
  });
});
