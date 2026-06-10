/**
 * Minimal shapes of the Lifecycle API payloads the CLI consumes.
 * Verified against lifecycle/src/app/api/v2 route implementations.
 */

export interface ApiEnvelope<T> {
  request_id: string;
  data: T | null;
  error: { message: string; code?: string; details?: Record<string, unknown> } | null;
  metadata?: { pagination?: PaginationMetadata };
}

export interface PaginationMetadata {
  page?: number;
  limit?: number;
  totalPages?: number;
  totalItems?: number;
  [key: string]: unknown;
}

export interface PullRequestSummary {
  id: number;
  title: string;
  fullName: string;
  githubLogin: string;
  pullRequestNumber: number;
  branchName: string;
  status?: string;
  labels?: string[] | null;
}

export interface Deployable {
  name: string;
  type?: string;
  dockerfilePath?: string;
  deploymentDependsOn?: string[];
  builder?: unknown;
  grpc?: boolean;
}

export interface ServiceOverrideState {
  name: string;
  active?: boolean;
  editable?: boolean;
  branchOrExternalUrl?: string | null;
  [key: string]: unknown;
}

export interface Deploy {
  id: number;
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
}

export interface Build {
  id: number;
  uuid: string;
  status: string;
  statusMessage?: string | null;
  namespace?: string;
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
}

export interface BuildListItem {
  id: number;
  uuid: string;
  status: string;
  namespace?: string;
  updatedAt?: string;
  createdAt?: string;
  pullRequest?: PullRequestSummary | null;
  deploys?: Array<{ id: number; uuid: string; status: string; active: boolean; deployable?: { name: string } | null }>;
}

export interface Site {
  id: string;
  name?: string | null;
  url: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string | null;
  fileCount?: number;
  sizeBytes?: number;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface ContainerInfo {
  name: string;
  state?: string;
  ready?: boolean;
  restarts?: number;
  image?: string;
}

/** lifecycle/src/server/lib/kubernetes/getEnvironmentPods.ts (serviceName only on env-wide list) */
export interface PodInfo {
  podName: string;
  serviceName?: string;
  status: string;
  restarts: number;
  ageSeconds: number;
  age: string;
  ready: string; // "X/Y"
  containers: ContainerInfo[];
}

/** lifecycle/src/server/lib/kubernetes/getNativeBuildJobs.ts */
export interface BuildJobInfo {
  jobName: string;
  buildUuid: string;
  sha: string;
  status: 'Active' | 'Complete' | 'Failed' | 'Pending';
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  engine: string;
  error?: string;
  podName?: string;
  source?: 'live' | 'archived';
}

/** lifecycle/src/server/lib/kubernetes/getDeploymentJobs.ts */
export interface DeployJobInfo {
  jobName: string;
  deployUuid: string;
  sha: string;
  status: 'Active' | 'Complete' | 'Failed' | 'Pending';
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  error?: string;
  podName?: string;
  deploymentType: string;
  source?: 'live' | 'archived';
}

/** lifecycle/src/server/services/logStreaming.ts */
export interface LogStreamInfo {
  status: string; // Active | Pending | Complete | Failed | NotFound | Archived
  streamingRequired: boolean;
  podName?: string;
  websocket?: {
    endpoint: string;
    parameters: { podName: string; namespace: string; follow: boolean; timestamps: boolean };
  };
  containers?: Array<{ name: string; state?: string }>;
  archivedLogs?: string;
  message?: string;
  error?: string;
}

/** lifecycle/src/server/models/WebhookInvocations.ts */
export interface WebhookInvocation {
  id?: number;
  runUUID: string;
  name: string;
  type: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  owner?: string | null;
  yamlConfig?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Build statuses (lifecycle/src/shared/constants.ts) */
export const BUILD_TERMINAL_SUCCESS = new Set(['deployed']);
export const BUILD_TERMINAL_FAILURE = new Set(['error', 'config_error', 'torn_down']);
export const BUILD_IN_PROGRESS = new Set(['pending', 'queued', 'building', 'deploying', 'built', 'tearing_down']);
