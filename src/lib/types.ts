import type {
  DeploymentJobInfo,
  DeploymentPodContainerInfo,
  EnvironmentPodInfo,
  Build as GeneratedBuild,
  Deploy as GeneratedDeploy,
  Deployable as GeneratedDeployable,
  PaginationMetadata as GeneratedPaginationMetadata,
  SitesConfig as GeneratedSitesConfig,
  LogStreamResponse,
  NativeBuildJobInfo,
  PullRequest,
  Site,
  SitesUploadConfig,
  WebhookInvocation,
} from './generated/index.js';

export type PaginationMetadata = GeneratedPaginationMetadata & {
  page?: number;
  totalPages?: number;
  totalItems?: number;
  [key: string]: unknown;
};

export interface ApiEnvelope<T> {
  request_id: string;
  data: T | null;
  error: { message: string; code?: string; details?: Record<string, unknown> } | null;
  metadata?: { pagination?: PaginationMetadata };
}

export type { Site, WebhookInvocation };

export interface SitesCliConfig {
  enabled: boolean;
  upload: SitesUploadConfig;
}

export interface SitesConfigCacheResponse {
  configs?: { sites?: GeneratedSitesConfig };
  sites?: GeneratedSitesConfig;
  config?: { sites?: GeneratedSitesConfig };
  data?: { sites?: GeneratedSitesConfig };
}

export type PullRequestSummary = PullRequest;

export type Deployable = Omit<Partial<GeneratedDeployable>, 'deploymentDependsOn' | 'builder'> & {
  name: string;
  deploymentDependsOn?: string | string[];
  builder?: unknown;
};

export interface ServiceOverrideState {
  name: string;
  active?: boolean;
  editable?: boolean;
  branchOrExternalUrl?: string | null;
  [key: string]: unknown;
}

export type Deploy = Omit<
  Partial<GeneratedDeploy>,
  | 'deployable'
  | 'repository'
  | 'serviceOverride'
  | 'status'
  | 'statusMessage'
  | 'cname'
  | 'branchName'
  | 'publicUrl'
  | 'dockerImage'
  | 'sha'
> & {
  id?: number;
  uuid: string;
  status: string;
  statusMessage?: string | null;
  active: boolean;
  cname?: string | null;
  branchName?: string | null;
  publicUrl?: string | null;
  dockerImage?: string | null;
  sha?: string | null;
  env?: Record<string, string> | null;
  initEnv?: Record<string, string> | null;
  createdAt?: string;
  updatedAt?: string;
  deployable?: Deployable | null;
  repository?: { fullName: string } | null;
  serviceOverride?: ServiceOverrideState | null;
};

export type Build = Omit<
  Partial<GeneratedBuild>,
  'baseBuild' | 'deploys' | 'manifest' | 'pullRequest' | 'sha' | 'status' | 'statusMessage'
> & {
  id?: number;
  uuid: string;
  status: string;
  statusMessage?: string | null;
  namespace: string;
  sha?: string | null;
  manifest?: unknown;
  isStatic?: boolean;
  trackDefaultBranches?: boolean;
  kind?: string;
  enableFullYaml?: boolean;
  webhooksYaml?: string | null;
  createdAt?: string;
  updatedAt?: string;
  commentRuntimeEnv?: Record<string, string> | null;
  commentInitEnv?: Record<string, string> | null;
  dependencyGraph?: unknown;
  pullRequest?: PullRequestSummary | null;
  deploys?: Deploy[];
  baseBuild?: { id: number; uuid: string } | null;
};

export type BuildListItem = Build;

export type ContainerInfo = Omit<Partial<DeploymentPodContainerInfo>, 'state' | 'image'> & {
  name: string;
  state?: string;
  ready?: boolean;
  restarts?: number;
  image?: string | null;
};

export type PodInfo = Omit<Partial<EnvironmentPodInfo>, 'containers' | 'ready' | 'serviceName'> & {
  podName: string;
  serviceName?: string;
  status: string;
  restarts: number;
  ageSeconds: number;
  age: string;
  ready: string | boolean;
  containers: ContainerInfo[];
};

export type BuildJobInfo = Omit<NativeBuildJobInfo, 'status' | 'engine' | 'source'> & {
  status: string;
  engine: string;
  source?: 'live' | 'archived';
};

export type DeployJobInfo = Omit<DeploymentJobInfo, 'status' | 'deploymentType' | 'source'> & {
  status: string;
  deploymentType: string;
  source?: 'live' | 'archived';
};

export type LogStreamInfo = Omit<LogStreamResponse, 'podName'> & { podName?: string | null };

export const BUILD_TERMINAL_SUCCESS = new Set(['deployed']);
export const BUILD_TERMINAL_FAILURE = new Set(['error', 'config_error', 'torn_down']);
export const BUILD_IN_PROGRESS = new Set(['pending', 'queued', 'building', 'deploying', 'built', 'tearing_down']);
