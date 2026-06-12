import { getAccessToken } from './auth.js';
import type { Profile } from './config.js';
import type {
  ApiEnvelope,
  Build,
  BuildJobInfo,
  BuildListItem,
  DeployJobInfo,
  LogStreamInfo,
  PaginationMetadata,
  PodInfo,
  ServiceOverrideState,
  Site,
  SitesCliConfig,
  SitesConfigCacheResponse,
  WebhookInvocation,
} from './types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly code?: string
  ) {
    super(message);
  }
}

export interface ListResult<T> {
  items: T[];
  pagination?: PaginationMetadata;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  form?: FormData;
}

export class ApiClient {
  constructor(
    private readonly profileName: string,
    private readonly profile: Profile,
    private readonly apiUrlOverride?: string
  ) {}

  get baseUrl(): string {
    return (this.apiUrlOverride || process.env.LIFECYCLE_API_URL || this.profile.apiUrl).replace(/\/$/, '');
  }

  private async request<T>(method: string, path: string, opts: RequestOptions = {}, retried = false): Promise<ApiEnvelope<T>> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {};
    const token = await getAccessToken(this.profileName, this.profile, { forceRefresh: retried });
    if (token) headers.Authorization = `Bearer ${token}`;

    let body: string | FormData | undefined;
    if (opts.form) {
      body = opts.form;
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }

    const res = await fetch(url, { method, headers, body });

    // a 401 with a token that looked valid usually means clock skew or revocation — force one refresh
    if (res.status === 401 && token && !retried) {
      return this.request<T>(method, path, opts, true);
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`, res.status);
      throw new ApiError(`Unexpected non-JSON response from ${path}`, res.status);
    }

    const envelope =
      parsed &&
      typeof parsed === 'object' &&
      ('request_id' in parsed || 'data' in parsed || 'error' in parsed)
        ? (parsed as ApiEnvelope<T>)
        : ({ request_id: '', data: parsed as T, error: null } satisfies ApiEnvelope<T>);

    if (!res.ok || envelope.error) {
      throw new ApiError(
        envelope.error?.message ?? `${res.status} ${res.statusText}`,
        res.status,
        envelope.request_id,
        envelope.error?.code
      );
    }
    return envelope;
  }

  // --- builds ---

  async listBuilds(params: {
    page?: number;
    limit?: number;
    search?: string;
    exclude?: string;
    myEnvs?: boolean;
  }): Promise<ListResult<BuildListItem>> {
    const env = await this.request<BuildListItem[]>('GET', '/api/v2/builds', {
      query: {
        page: params.page,
        limit: params.limit,
        search: params.search || undefined,
        exclude: params.exclude,
        my_envs: params.myEnvs ? 'true' : undefined,
      },
    });
    return { items: env.data ?? [], pagination: env.metadata?.pagination };
  }

  async getBuild(uuid: string): Promise<Build> {
    const env = await this.request<Build>('GET', `/api/v2/builds/${encodeURIComponent(uuid)}`);
    return env.data as Build;
  }

  async patchBuild(uuid: string, patch: Record<string, unknown>): Promise<Build> {
    const env = await this.request<Build>('PATCH', `/api/v2/builds/${encodeURIComponent(uuid)}`, { json: patch });
    return env.data as Build;
  }

  async redeployBuild(uuid: string): Promise<unknown> {
    const env = await this.request<unknown>('PUT', `/api/v2/builds/${encodeURIComponent(uuid)}/redeploy`);
    return env.data;
  }

  async destroyBuild(uuid: string): Promise<unknown> {
    const env = await this.request<unknown>('PUT', `/api/v2/builds/${encodeURIComponent(uuid)}/destroy`);
    return env.data;
  }

  async redeployService(uuid: string, service: string): Promise<unknown> {
    const env = await this.request<unknown>(
      'PUT',
      `/api/v2/builds/${encodeURIComponent(uuid)}/services/${encodeURIComponent(service)}/redeploy`
    );
    return env.data;
  }

  async patchServiceOverrides(
    uuid: string,
    overrides: Array<{ name: string; active?: boolean; branchOrExternalUrl?: string }>
  ): Promise<{ serviceOverrides: ServiceOverrideState[]; queued?: unknown }> {
    const env = await this.request<{ serviceOverrides: ServiceOverrideState[]; queued?: unknown }>(
      'PATCH',
      `/api/v2/builds/${encodeURIComponent(uuid)}/services`,
      { json: { serviceOverrides: overrides } }
    );
    return env.data as { serviceOverrides: ServiceOverrideState[]; queued?: unknown };
  }

  // --- pods, jobs, logs, webhooks ---

  async listEnvironmentPods(uuid: string): Promise<PodInfo[]> {
    const env = await this.request<{ pods: PodInfo[] }>('GET', `/api/v2/builds/${encodeURIComponent(uuid)}/pods`);
    return env.data?.pods ?? [];
  }

  async listServicePods(uuid: string, service: string): Promise<PodInfo[]> {
    const env = await this.request<{ pods: PodInfo[] }>(
      'GET',
      `/api/v2/builds/${encodeURIComponent(uuid)}/services/${encodeURIComponent(service)}/pods`
    );
    return env.data?.pods ?? [];
  }

  async listBuildJobs(uuid: string, service: string): Promise<BuildJobInfo[]> {
    const env = await this.request<{ builds: BuildJobInfo[] }>(
      'GET',
      `/api/v2/builds/${encodeURIComponent(uuid)}/services/${encodeURIComponent(service)}/build-jobs`
    );
    return env.data?.builds ?? [];
  }

  async listDeployJobs(uuid: string, service: string): Promise<DeployJobInfo[]> {
    const env = await this.request<{ deployments: DeployJobInfo[] }>(
      'GET',
      `/api/v2/builds/${encodeURIComponent(uuid)}/services/${encodeURIComponent(service)}/deploy-jobs`
    );
    return env.data?.deployments ?? [];
  }

  async getJobLogInfo(uuid: string, service: string, jobName: string, kind: 'build' | 'deploy'): Promise<LogStreamInfo> {
    const segment = kind === 'build' ? 'build-jobs' : 'deploy-jobs';
    const env = await this.request<LogStreamInfo>(
      'GET',
      `/api/v2/builds/${encodeURIComponent(uuid)}/services/${encodeURIComponent(service)}/${segment}/${encodeURIComponent(jobName)}`
    );
    return env.data as LogStreamInfo;
  }

  async listWebhookInvocations(uuid: string): Promise<WebhookInvocation[]> {
    const env = await this.request<WebhookInvocation[]>('GET', `/api/v2/builds/${encodeURIComponent(uuid)}/webhooks`);
    return env.data ?? [];
  }

  async invokeWebhooks(uuid: string): Promise<unknown> {
    const env = await this.request<unknown>('POST', `/api/v2/builds/${encodeURIComponent(uuid)}/webhooks`);
    return env.data;
  }

  /** Server-side schema validation of the lifecycle config on a GitHub branch. */
  async validateSchema(repo: string, branch: string): Promise<{ valid: boolean }> {
    const env = await this.request<{ valid: boolean }>('GET', '/api/v2/schema/validate', {
      query: { repo, branch },
    });
    return env.data as { valid: boolean };
  }

  // --- sites ---

  async listSites(params: { page?: number; limit?: number; user?: string }): Promise<ListResult<Site>> {
    const env = await this.request<{ sites: Site[] }>('GET', '/api/v2/sites', {
      query: { page: params.page, limit: params.limit, user: params.user },
    });
    return { items: env.data?.sites ?? [], pagination: env.metadata?.pagination };
  }

  async getSitesConfig(): Promise<SitesCliConfig> {
    const env = await this.request<SitesConfigCacheResponse>('GET', '/api/v1/config/cache');
    const sites = env.data?.configs?.sites ?? env.data?.sites ?? env.data?.config?.sites ?? env.data?.data?.sites;
    if (!sites) throw new ApiError('Could not load sites lifecycle. Try again later.', 0, env.request_id);
    return {
      enabled: sites.enabled,
      upload: sites.upload,
    };
  }

  async createSite(form: FormData): Promise<Site> {
    const env = await this.request<{ site: Site }>('POST', '/api/v2/sites', { form });
    return (env.data as { site: Site }).site;
  }

  async getSite(siteId: string): Promise<Site> {
    const env = await this.request<{ site: Site }>('GET', `/api/v2/sites/${encodeURIComponent(siteId)}`);
    return (env.data as { site: Site }).site;
  }

  async deleteSite(siteId: string): Promise<Site> {
    const env = await this.request<{ site: Site }>('DELETE', `/api/v2/sites/${encodeURIComponent(siteId)}`);
    return (env.data as { site: Site }).site;
  }

  async extendSite(siteId: string): Promise<Site> {
    const env = await this.request<{ site: Site }>('POST', `/api/v2/sites/${encodeURIComponent(siteId)}/extend`);
    return (env.data as { site: Site }).site;
  }

  async replaceSiteContent(siteId: string, form: FormData): Promise<Site> {
    const env = await this.request<{ site: Site }>('PUT', `/api/v2/sites/${encodeURIComponent(siteId)}/content`, {
      form,
    });
    return (env.data as { site: Site }).site;
  }
}
