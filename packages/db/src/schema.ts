import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type {
  AdrStatus,
  BoardBackend,
  ClaimStatus,
  ContainerNetworkMode,
  ContainerStatus,
  ContractStatus,
  ContractVerification,
  DecisionOutcome,
  DocumentSource,
  DocumentType,
  EventLevel,
  EventSource,
  GateKind,
  IndexedStatus,
  JoinPolicy,
  MemoryScope,
  ModelCapability,
  NodeType,
  PermissionMode,
  PolicyClass,
  ProposalKind,
  ProposalStatus,
  RepoProvider,
  RuleKind,
  RunStatus,
  StepStatus,
  SubagentCategory,
  UsageKind,
  UserRole,
} from "@factoria/shared";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

// --- Identity ---

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").$type<UserRole>().notNull().default("member"),
  createdAt: createdAt(),
});

// --- Catálogo de IA ---

export const providers = pgTable("providers", {
  id: id(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  createdAt: createdAt(),
});

export const models = pgTable("models", {
  id: id(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull(),
  contextWindow: integer("context_window"),
  capabilities: jsonb("capabilities").$type<ModelCapability[]>().notNull().default([]),
  costInputPer1M: numeric("cost_input_per_1m"),
  costOutputPer1M: numeric("cost_output_per_1m"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});

// --- Subagentes ---

export const subagents = pgTable("subagents", {
  id: id(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  instructions: text("instructions").notNull(),
  category: text("category").$type<SubagentCategory>().notNull(),
  defaultModelId: uuid("default_model_id").references(() => models.id, { onDelete: "set null" }),
  temperature: numeric("temperature"),
  permissions: jsonb("permissions")
    .$type<Record<string, PermissionMode | Record<string, PermissionMode>>>()
    .notNull()
    .default({}),
  allowedTools: jsonb("allowed_tools").$type<string[]>().notNull().default([]),
  outputContract: text("output_contract"),
  canDelegateTo: jsonb("can_delegate_to").$type<string[]>().notNull().default([]),
  maxDepth: integer("max_depth").notNull().default(1),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  mcpServers: jsonb("mcp_servers").$type<string[]>().notNull().default([]),
  mode: text("mode").$type<"subagent" | "primary">().notNull().default("subagent"),
  createdAt: createdAt(),
});

// --- Flujo de trabajo ---

export const workflows = pgTable("workflows", {
  id: id(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isTemplate: boolean("is_template").notNull().default(false),
  published: boolean("published").notNull().default(false),
  category: text("category"),
  version: integer("version").notNull().default(1),
  variables: jsonb("variables").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workflowVersions = pgTable("workflow_versions", {
  id: id(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  graph: jsonb("graph").$type<unknown>().notNull(),
  createdAt: createdAt(),
});

export const workflowNodes = pgTable("workflow_nodes", {
  id: id(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  type: text("type").$type<NodeType>().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  modelId: uuid("model_id").references(() => models.id, { onDelete: "set null" }),
  subagentId: uuid("subagent_id").references(() => subagents.id, { onDelete: "set null" }),
  expectedResult: text("expected_result"),
  harness: jsonb("harness").$type<Record<string, unknown>>().notNull().default({}),
  workingDir: text("working_dir").notNull().default("."),
  joinPolicy: text("join_policy").$type<JoinPolicy>().notNull().default("all"),
  loopGuard: jsonb("loop_guard").$type<{ maxIterations: number } | null>(),
  errorHandling: jsonb("error_handling").$type<Record<string, unknown>>(),
  dataMapping: jsonb("data_mapping").$type<Record<string, unknown>>(),
  usesWorkflowId: uuid("uses_workflow_id"),
  disabled: boolean("disabled").notNull().default(false),
  position: jsonb("position").$type<{ x: number; y: number }>(),
});

export const workflowEdges = pgTable("workflow_edges", {
  id: id(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  fromNodeKey: text("from_node_key").notNull(),
  toNodeKey: text("to_node_key").notNull(),
  condition: jsonb("condition").$type<Record<string, unknown>>(),
});

// --- Proyecto ---

export const projects = pgTable("projects", {
  id: id(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  programName: text("program_name").notNull(),
  objective: text("objective").notNull(),
  description: text("description"),
  stack: jsonb("stack").$type<string[]>().notNull().default([]),
  workspaceRoot: text("workspace_root"),
  workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  embeddingModelId: uuid("embedding_model_id").references(() => models.id, { onDelete: "set null" }),
  rerankModelId: uuid("rerank_model_id").references(() => models.id, { onDelete: "set null" }),
  assistantModelId: uuid("assistant_model_id").references(() => models.id, { onDelete: "set null" }),
  assistantHarness: jsonb("assistant_harness").$type<Record<string, unknown>>(),
  assistantInstructions: text("assistant_instructions"),
  assistantSessionRef: text("assistant_session_ref"),
  defaultHarness: jsonb("default_harness").$type<Record<string, unknown>>(),
  repoUrl: text("repo_url"),
  repoBranch: text("repo_branch"),
  repoProvider: text("repo_provider").$type<RepoProvider>(),
  repoUsername: text("repo_username"),
  repoTokenEncrypted: text("repo_token_encrypted"),
  containerImage: text("container_image"),
  containerEnabled: boolean("container_enabled").notNull().default(true),
  containerNetworkMode: text("container_network_mode").$type<ContainerNetworkMode>().notNull().default("closed"),
  devCommand: text("dev_command"),
  devPort: integer("dev_port").notNull().default(3000),
  stateBackend: text("state_backend").$type<BoardBackend>().notNull().default("internal"),
  boardName: text("board_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const projectFeatures = pgTable("project_features", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("pending"),
});

export const contracts = pgTable("contracts", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  criterion: text("criterion").notNull(),
  verification: text("verification").$type<ContractVerification>().notNull().default("llm"),
  verificationConfig: jsonb("verification_config").$type<Record<string, unknown>>(),
  status: text("status").$type<ContractStatus>().notNull().default("pending"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  order: integer("order").notNull().default(0),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const documents = pgTable("documents", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").$type<DocumentType>().notNull(),
  title: text("title").notNull(),
  mimeType: text("mime_type"),
  storagePath: text("storage_path"),
  textExtracted: text("text_extracted"),
  indexedStatus: text("indexed_status").$type<IndexedStatus>().notNull().default("pending"),
  source: text("source").$type<DocumentSource>().notNull().default("uploaded"),
  createdAt: createdAt(),
});

export const documentChunks = pgTable("document_chunks", {
  id: id(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

// --- Ejecución ---

export const workflowRuns = pgTable("workflow_runs", {
  id: id(),
  kind: text("kind").notNull().default("flow"),
  sourceRunId: uuid("source_run_id"),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
  graphSnapshot: jsonb("graph_snapshot").$type<unknown>().notNull(),
  status: text("status").$type<RunStatus>().notNull().default("queued"),
  currentNodes: jsonb("current_nodes").$type<string[]>().notNull().default([]),
  triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const stepRuns = pgTable("step_runs", {
  id: id(),
  runId: uuid("run_id")
    .notNull()
    .references(() => workflowRuns.id, { onDelete: "cascade" }),
  nodeKey: text("node_key").notNull(),
  iteration: integer("iteration").notNull().default(1),
  status: text("status").$type<StepStatus>().notNull().default("pending"),
  subagentId: uuid("subagent_id").references(() => subagents.id, { onDelete: "set null" }),
  modelId: uuid("model_id").references(() => models.id, { onDelete: "set null" }),
  executor: text("executor"),
  sessionRef: text("session_ref"),
  worktreeRef: text("worktree_ref"),
  promptSent: text("prompt_sent"),
  verdict: jsonb("verdict").$type<Record<string, unknown>>(),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const stepRunDependencies = pgTable("step_run_dependencies", {
  id: id(),
  runId: uuid("run_id")
    .notNull()
    .references(() => workflowRuns.id, { onDelete: "cascade" }),
  stepRunId: uuid("step_run_id")
    .notNull()
    .references(() => stepRuns.id, { onDelete: "cascade" }),
  dependsOnStepRunId: uuid("depends_on_step_run_id")
    .notNull()
    .references(() => stepRuns.id, { onDelete: "cascade" }),
});

// --- Observabilidad, coste y conocimiento ---

export const runEvents = pgTable(
  "run_events",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepRunId: uuid("step_run_id").references(() => stepRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    level: text("level").$type<EventLevel>().notNull().default("info"),
    source: text("source").$type<EventSource>().notNull().default("system"),
    message: text("message").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("run_events_run_seq_idx").on(t.runId, t.seq)],
);

export const traceSpans = pgTable("trace_spans", {
  id: id(),
  runId: uuid("run_id")
    .notNull()
    .references(() => workflowRuns.id, { onDelete: "cascade" }),
  stepRunId: uuid("step_run_id").references(() => stepRuns.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  attributes: jsonb("attributes").$type<Record<string, unknown>>(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cost: numeric("cost").notNull().default("0"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const usageRecords = pgTable("usage_records", {
  id: id(),
  runId: uuid("run_id").references(() => workflowRuns.id, { onDelete: "cascade" }),
  stepRunId: uuid("step_run_id").references(() => stepRuns.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  providerId: uuid("provider_id").references(() => providers.id, { onDelete: "set null" }),
  modelId: uuid("model_id").references(() => models.id, { onDelete: "set null" }),
  subagentId: uuid("subagent_id").references(() => subagents.id, { onDelete: "set null" }),
  kind: text("kind").$type<UsageKind>().notNull().default("chat"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  cost: numeric("cost").notNull().default("0"),
  createdAt: createdAt(),
});

export const projectBudgets = pgTable("project_budgets", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  webhookUrl: text("webhook_url"),
  limitUsd: numeric("limit_usd"),
  softLimitUsd: numeric("soft_limit_usd"),
  alertedAt: timestamp("alerted_at", { withTimezone: true }),
  period: text("period").notNull().default("monthly"),
});

export const longTermMemory = pgTable("long_term_memory", {
  id: id(),
  scope: text("scope").$type<MemoryScope>().notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  subagentId: uuid("subagent_id").references(() => subagents.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const assistantMessages = pgTable("assistant_messages", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  attachments: jsonb("attachments").$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const assistantProposals = pgTable("assistant_proposals", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").$type<ProposalKind>().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<ProposalStatus>().notNull().default("pending"),
  createdAt: createdAt(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const runSummaries = pgTable("run_summaries", {
  id: id(),
  runId: uuid("run_id")
    .notNull()
    .references(() => workflowRuns.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  fromSeq: integer("from_seq").notNull(),
  toSeq: integer("to_seq").notNull(),
  summary: text("summary").notNull(),
  modelId: uuid("model_id").references(() => models.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const workflowEditHistory = pgTable("workflow_edit_history", {
  id: id(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").$type<unknown>().notNull(),
  createdAt: createdAt(),
});

// --- Método/Karajan: contenedores, gates, gobernanza ---

export const projectContainers = pgTable("project_containers", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" })
    .unique(),
  containerId: text("container_id"),
  name: text("name"),
  status: text("status").$type<ContainerStatus>().notNull().default("stopped"),
  image: text("image"),
  networkMode: text("network_mode").$type<ContainerNetworkMode>().notNull().default("closed"),
  endpoint: text("endpoint"),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
  lastStoppedAt: timestamp("last_stopped_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

export const reviewVerdicts = pgTable(
  "review_verdicts",
  {
    id: id(),
    runId: uuid("run_id").references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepRunId: uuid("step_run_id").references(() => stepRuns.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    diffHash: text("diff_hash").notNull(),
    verdict: text("verdict").notNull(),
    reviewerModelId: text("reviewer_model_id"),
    reviewerFamily: text("reviewer_family"),
    authorModelId: text("author_model_id"),
    summary: text("summary"),
    confidence: numeric("confidence"),
    workspace: text("workspace").notNull().default("root"),
    arbitrated: boolean("arbitrated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("review_verdicts_project_diff_idx").on(t.projectId, t.diffHash)],
);

export const policyRules = pgTable("policy_rules", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull(),
  source: text("source").notNull(),
  literalText: text("literal_text").notNull(),
  kind: text("kind").$type<RuleKind | "none">().notNull().default("none"),
  klass: text("klass").$type<PolicyClass>().notNull().default("process"),
  gate: text("gate").$type<GateKind>(),
  condition: jsonb("condition").$type<Record<string, unknown>>(),
  approved: boolean("approved").notNull().default(false),
  createdAt: createdAt(),
});

export const policyDecisions = pgTable("policy_decisions", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => workflowRuns.id, { onDelete: "cascade" }),
  stepRunId: uuid("step_run_id").references(() => stepRuns.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  gate: text("gate").$type<GateKind | "review" | "claims" | "steward" | "release">().notNull(),
  outcome: text("outcome").$type<DecisionOutcome>().notNull(),
  ruleId: text("rule_id"),
  klass: text("klass").$type<PolicyClass>(),
  reason: text("reason").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  createdAt: createdAt(),
});

export const agentClaims = pgTable("agent_claims", {
  id: id(),
  runId: uuid("run_id").references(() => workflowRuns.id, { onDelete: "cascade" }),
  stepRunId: uuid("step_run_id").references(() => stepRuns.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  status: text("status").$type<ClaimStatus>().notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const architectureDecisions = pgTable("architecture_decisions", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  status: text("status").$type<AdrStatus>().notNull().default("proposed"),
  context: text("context").notNull().default(""),
  decision: text("decision").notNull(),
  consequences: text("consequences").notNull().default(""),
  gitPath: text("git_path"),
  createdAt: createdAt(),
});
