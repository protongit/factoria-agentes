const base = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    credentials: "include",
    headers,
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const put = <T>(p: string, body?: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body ?? {}) });
const patch = <T>(p: string, body?: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body ?? {}) });
const del = (p: string) => request<void>(p, { method: "DELETE" });

export interface User { id: string; email: string; name: string; role: string }
export interface Provider { id: string; name: string; baseUrl?: string | null }
export interface Model {
  id: string; providerId: string; modelId: string; displayName: string;
  contextWindow?: number | null; capabilities: string[]; enabled: boolean;
}
export interface Subagent {
  id: string; name: string; description: string; instructions: string; category: string;
  defaultModelId?: string | null; permissions: Record<string, unknown>; outputContract?: string | null;
}
export interface Workflow { id: string; name: string; description?: string | null; version: number; published: boolean; variables?: Record<string, unknown> }
export interface WorkflowNodeRow {
  id?: string; key: string; type: string; name: string; description?: string | null;
  modelId?: string | null; subagentId?: string | null; expectedResult?: string | null;
  workingDir?: string | null; joinPolicy?: string | null; position?: { x: number; y: number } | null;
}
export interface WorkflowEdgeRow { fromNodeKey: string; toNodeKey: string; condition?: { on?: string } | null }
export interface WorkflowFull extends Workflow { nodes: WorkflowNodeRow[]; edges: WorkflowEdgeRow[] }
export interface Feature { id: string; title: string; description?: string | null; priority: number; status: string }
export interface Contract { id: string; title: string; criterion: string; verification: string; status: string }
export interface ProjectDocument { id: string; type: string; title: string; storagePath?: string | null; source: string; indexedStatus: string }
export interface Project {
  id: string; name: string; programName: string; objective: string; description?: string | null;
  stack: string[]; workspaceRoot?: string | null; workflowId?: string | null; status: string;
  assistantModelId?: string | null;
  repoUrl?: string | null; repoBranch?: string | null; repoProvider?: string | null;
  hasRepoToken?: boolean; containerImage?: string | null; containerEnabled?: boolean;
  containerNetworkMode?: string | null;
  devCommand?: string | null; devPort?: number | null;
}
export interface ProjectFull extends Project {
  features: Feature[]; contracts: Contract[]; documents: ProjectDocument[];
}
export interface StepRun { id: string; nodeKey: string; iteration: number; status: string; error?: string | null; startedAt?: string | null; finishedAt?: string | null }
export interface Run { id: string; projectId: string; status: string; currentNodes: string[]; createdAt: string }
export interface RunFull extends Run { steps: StepRun[] }
export type RunAlertKind = "approval" | "failed" | "succeeded" | "cancelled";
export interface NotificationAlert {
  id: string;
  kind: RunAlertKind;
  runId: string;
  projectId: string;
  projectName: string;
  nodeKey?: string;
  nodeName?: string;
  message: string;
  error?: string;
  createdAt: string;
  nextSteps: string[];
  href: string;
}
export interface RunEvent {
  id: string; seq: number; level: string; source: string; message: string; stepRunId?: string | null;
  payload?: Record<string, unknown> | null; createdAt: string;
}
export interface AssistantMessage { id: string; role: string; content: string; createdAt: string }

export const api = {
  health: () => get<{ status: string }>("/api/health"),
  me: () => get<User>("/api/auth/me"),
  login: (email: string, password: string) => post<User>("/api/auth/login", { email, password }),
  register: (email: string, password: string, name: string) => post<User>("/api/auth/register", { email, password, name }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout"),

  providers: () => get<Provider[]>("/api/providers"),
  createProvider: (d: { name: string; apiKey: string; baseUrl?: string }) => post<Provider>("/api/providers", d),
  deleteProvider: (id: string) => del(`/api/providers/${id}`),

  models: () => get<Model[]>("/api/models"),
  createModel: (d: { providerId: string; modelId: string; displayName: string; capabilities: string[]; contextWindow?: number }) =>
    post<Model>("/api/models", d),
  deleteModel: (id: string) => del(`/api/models/${id}`),

  subagents: () => get<Subagent[]>("/api/subagents"),
  subagentTemplates: () => get<{ name: string; description: string; category: string; instructions: string }[]>("/api/subagents/templates"),
  seedSubagents: () => post<{ created: number }>("/api/subagents/seed"),
  createSubagent: (d: Partial<Subagent>) => post<Subagent>("/api/subagents", d),
  deleteSubagent: (id: string) => del(`/api/subagents/${id}`),
  materializeSubagent: (id: string, target: string) => get<{ filename: string; content: string }>(`/api/subagents/${id}/materialize?target=${target}`),

  workflows: () => get<Workflow[]>("/api/workflows"),
  workflow: (id: string) => get<WorkflowFull>(`/api/workflows/${id}`),
  createWorkflow: (d: unknown) => post<WorkflowFull>("/api/workflows", d),
  saveWorkflow: (id: string, d: unknown) => put<WorkflowFull>(`/api/workflows/${id}`, d),
  deleteWorkflow: (id: string) => del(`/api/workflows/${id}`),
  workflowFromTemplate: () => post<Workflow>("/api/workflows/from-template"),

  projects: () => get<Project[]>("/api/projects"),
  project: (id: string) => get<ProjectFull>(`/api/projects/${id}`),
  createProject: (d: { name: string; programName: string; objective: string; stack?: string[]; workflowId?: string }) =>
    post<Project>("/api/projects", d),
  updateProject: (id: string, d: unknown) => patch<Project>(`/api/projects/${id}`, d),
  deleteProject: (id: string) => del(`/api/projects/${id}`),
  addFeature: (id: string, d: { title: string; description?: string }) => post<Feature>(`/api/projects/${id}/features`, d),
  deleteFeature: (id: string, fid: string) => del(`/api/projects/${id}/features/${fid}`),
  addContract: (id: string, d: { title: string; criterion: string; verification?: string }) => post<Contract>(`/api/projects/${id}/contracts`, d),
  deleteContract: (id: string, cid: string) => del(`/api/projects/${id}/contracts/${cid}`),
  addDocument: (id: string, d: { type?: string; title: string; text?: string }) => post<ProjectDocument>(`/api/projects/${id}/documents`, d),
  uploadDocument: (id: string, d: { title?: string; filename: string; mimeType?: string; dataBase64: string }) =>
    post<{ document: ProjectDocument; chunks: number }>(`/api/projects/${id}/documents/upload`, d),
  deleteDocument: (id: string, did: string) => del(`/api/projects/${id}/documents/${did}`),
  generateImage: (id: string, prompt: string, modelId?: string) => post<ProjectDocument>(`/api/projects/${id}/generate-image`, { prompt, modelId }),

  assistantMessages: (id: string) => get<AssistantMessage[]>(`/api/projects/${id}/assistant/messages`),
  assistantSend: (id: string, content: string) =>
    post<{ message: AssistantMessage; proposal?: { id: string; kind: string; payload: unknown } }>(`/api/projects/${id}/assistant/messages`, { content }),
  assistantProposals: (id: string) => get<{ id: string; kind: string; payload: unknown }[]>(`/api/projects/${id}/assistant/proposals`),
  assistantDecide: (id: string, pid: string, decision: "accept" | "reject") =>
    post<{ ok: boolean }>(`/api/projects/${id}/assistant/proposals/${pid}/${decision}`),
  assistantSummarize: (id: string, sinceSeq: number) =>
    post<{ summary: string }>(`/api/projects/${id}/assistant/summarize?sinceSeq=${sinceSeq}`),

  runs: (projectId: string) => get<Run[]>(`/api/projects/${projectId}/runs`),
  run: (runId: string) => get<RunFull>(`/api/runs/${runId}`),
  startRun: (projectId: string, workflowId?: string) => post<Run>(`/api/projects/${projectId}/runs`, { workflowId }),
  runEvents: (runId: string, sinceSeq = 0) => get<RunEvent[]>(`/api/runs/${runId}/events?sinceSeq=${sinceSeq}`),
  runUsage: (runId: string) => get<{ totals: { inputTokens: number; outputTokens: number; cost: number }; count: number }>(`/api/runs/${runId}/usage`),
  runTraces: (runId: string) => get<TraceSpan[]>(`/api/runs/${runId}/traces`),
  runSummary: (runId: string) => get<{ summary: string }[]>(`/api/runs/${runId}/summary`),
  notifications: () => get<{ alerts: NotificationAlert[] }>("/api/notifications"),
  pauseRun: (runId: string) => post<{ ok: boolean }>(`/api/runs/${runId}/pause`),
  resumeRun: (runId: string) => post<{ ok: boolean }>(`/api/runs/${runId}/resume`),
  cancelRun: (runId: string) => post<{ ok: boolean }>(`/api/runs/${runId}/cancel`),
  approveRun: (runId: string, stepRunId: string, approved: boolean) =>
    post<{ ok: boolean }>(`/api/runs/${runId}/approve`, { stepRunId, approved }),

  providerTest: (id: string) => post<{ ok: boolean; models?: number; error?: string }>(`/api/providers/${id}/test`),
  providerSync: (id: string) => post<{ ok: boolean; created?: number; found?: number; error?: string }>(`/api/providers/${id}/sync`),

  indexDocument: (id: string, docId: string) => post<{ indexed: boolean; chunks: number }>(`/api/projects/${id}/documents/${docId}/index`),
  reindexProject: (id: string) => post<{ documents: number; indexed: number }>(`/api/projects/${id}/index`),
  searchProject: (id: string, q: string) =>
    get<{ mode: string; results: { title: string; snippet: string; score: number }[] }>(`/api/projects/${id}/search?q=${encodeURIComponent(q)}`),
  memoryAdd: (id: string, content: string) => post<{ id: string }>(`/api/projects/${id}/memory`, { content }),
  memorySearch: (id: string, q: string) => get<{ id: string; content: string; scope: string }[]>(`/api/projects/${id}/memory?q=${encodeURIComponent(q)}`),

  getBudget: (id: string) => get<{ limitUsd?: string | null; softLimitUsd?: string | null; webhookUrl?: string | null; period?: string }>(`/api/projects/${id}/budget`),
  setBudget: (id: string, d: { limitUsd?: number; softLimitUsd?: number; webhookUrl?: string }) => put<unknown>(`/api/projects/${id}/budget`, d),
  testWebhook: (id: string) => post<{ ok: boolean }>(`/api/projects/${id}/budget/test-webhook`),
  projectUsage: (id: string) => get<{ totals: { inputTokens: number; outputTokens: number; cost: number }; records: number }>(`/api/projects/${id}/usage`),

  workflowVersions: (id: string) => get<{ id: string; version: number; createdAt: string }[]>(`/api/workflows/${id}/versions`),
  workflowRestore: (id: string, version: number) => post<{ ok: boolean; version: number }>(`/api/workflows/${id}/restore/${version}`),
  workflowExport: async (id: string) => {
    const res = await fetch(`${base}/api/workflows/${id}/export`, { credentials: "include" });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  },
  workflowImport: (data: unknown) => post<Workflow>(`/api/workflows/import`, data),
  workflowTemplates: () => get<{ name: string; description: string; category: string; nodes: unknown[]; edges: unknown[] }[]>("/api/workflows/templates"),
  historyList: (id: string) => get<{ entries: { id: string; createdAt: string }[] }>(`/api/workflows/${id}/history`),
  historyPush: (id: string, snapshot: unknown, currentIndex?: number) =>
    post<{ index: number }>(`/api/workflows/${id}/history/push`, { snapshot, currentIndex }),
  historyMove: (id: string, currentIndex: number, delta: number) =>
    post<{ snapshot: unknown; index: number }>(`/api/workflows/${id}/history/move`, { currentIndex, delta }),
  testNode: (projectId: string, node: unknown) => post<Run>(`/api/projects/${projectId}/nodes/test`, node),
  replayRun: (runId: string, fromNodeKey: string) => post<Run>(`/api/runs/${runId}/replay`, { fromNodeKey }),
  usageByModel: (id: string) =>
    get<{ rows: { modelId: string | null; kind: string; inputTokens: number; outputTokens: number; cost: number; count: number; pct: number }[]; totalCost: number }>(`/api/projects/${id}/usage/by-model`),
  usageDaily: (id: string, days = 30) =>
    get<{ rows: { day: string; cost: number; tokens: number }[] }>(`/api/projects/${id}/usage/daily?days=${days}`),
  tracesOtelUrl: (runId: string) => `/api/runs/${runId}/traces/otel`,

  listFiles: (id: string, path = "") =>
    get<{ path: string; exists: boolean; entries: WorkspaceEntry[] }>(`/api/projects/${id}/files?path=${encodeURIComponent(path)}`),
  readFile: (id: string, path: string) =>
    get<FileContent>(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`),
  previewInfo: (id: string) =>
    get<{
      exists: boolean; hasIndex: boolean; hasPackageJson: boolean; scripts: Record<string, string>;
      devCommand: string; devPort: number;
    }>(`/api/projects/${id}/preview-info`),
  previewUrl: (id: string) => `${base}/api/projects/${id}/preview/`,
  projectDownloadUrl: (id: string) => `${base}/api/projects/${id}/download`,
  appStatus: (id: string) =>
    get<{ running: boolean; container: string; port: number; hostPort?: number | null; endpoint?: string | null; command: string }>(
      `/api/projects/${id}/app/status`,
    ),
  appStart: (id: string) =>
    post<{ running: boolean; port: number; hostPort?: number | null; endpoint?: string | null; command: string }>(
      `/api/projects/${id}/app/start`,
    ),
  appStop: (id: string) => post<{ ok: boolean; running: boolean }>(`/api/projects/${id}/app/stop`),
  appLogs: (id: string) => get<{ logs: string }>(`/api/projects/${id}/app/logs`),

  repoTest: (id: string, d: { repoUrl?: string; repoToken?: string; repoProvider?: string }) =>
    post<{ ok: boolean; branches: string[]; message: string }>(`/api/projects/${id}/repo/test`, d),

  containerStatus: (id: string) =>
    get<{ status: string; available: boolean; name?: string; image?: string; endpoint?: string; lastError?: string }>(
      `/api/projects/${id}/container/status`,
    ),
  containerUp: (id: string) => post<{ running: boolean; name: string; error?: string }>(`/api/projects/${id}/container/up`),
  containerDown: (id: string) => post<{ ok: boolean; status: string }>(`/api/projects/${id}/container/down`),
  containerRebuild: (id: string) => post<{ running: boolean; name: string; error?: string }>(`/api/projects/${id}/container/rebuild`),
  containerLogs: (id: string) => get<{ logs: string }>(`/api/projects/${id}/container/logs`),

  governance: (id: string) =>
    get<{ entries: LedgerEntry[]; report: { total: number; denies: number; exceptions: number; chain: { ok: boolean; brokenAt?: number }; head: string } }>(
      `/api/projects/${id}/governance`,
    ),
  governanceAnchor: (id: string) => post<{ head: string; total: number }>(`/api/projects/${id}/governance/anchor`),

  reviews: (id: string) => get<ReviewVerdict[]>(`/api/projects/${id}/reviews`),
  adrs: (id: string) => get<Adr[]>(`/api/projects/${id}/adrs`),
  createAdr: (id: string, d: { title: string; decision: string; context?: string; consequences?: string }) => post<Adr>(`/api/projects/${id}/adrs`, d),
  policies: (id: string) => get<{ rules: PolicyRule[]; fromFile: unknown[] }>(`/api/projects/${id}/policies`),
  compilePolicies: (id: string) => post<{ proposed: number }>(`/api/projects/${id}/policies/compile`),
  approvePolicy: (id: string, ruleId: string) => post<unknown>(`/api/projects/${id}/policies/${ruleId}/approve`),
  claims: (id: string) => get<AgentClaim[]>(`/api/projects/${id}/claims`),
  stewardSweep: (id: string) => post<{ changes: unknown[]; stale: unknown[] }>(`/api/projects/${id}/steward/sweep`),
};

export interface LedgerEntry {
  seq: number; gate: string; outcome: string; reason: string; ruleId?: string | null; klass?: string | null;
  prevHash?: string | null; hash: string; createdAt: string;
}
export interface ReviewVerdict {
  id: string; diffHash: string; verdict: string; reviewerModelId?: string | null; authorModelId?: string | null;
  summary?: string | null; confidence?: string | null; createdAt: string;
}
export interface Adr { id: string; number: number; title: string; status: string; decision: string; context: string; consequences: string; gitPath?: string | null }
export interface PolicyRule { id: string; ruleId: string; source: string; literalText: string; kind: string; klass: string; approved: boolean }
export interface AgentClaim { id: string; text: string; status: string; createdAt: string }

export interface WorkspaceEntry { name: string; type: "dir" | "file"; size: number; mtime: number }
export interface FileContent { path: string; size: number; binary: boolean; truncated: boolean; content: string | null }

export interface TraceSpan {
  id: string; kind: string; name: string; parentId?: string | null; inputTokens: number; outputTokens: number;
  cost: string; startedAt: string; endedAt?: string | null; stepRunId?: string | null;
}
