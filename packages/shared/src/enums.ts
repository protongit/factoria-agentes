export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MODEL_CAPABILITIES = [
  "code",
  "vision",
  "reasoning",
  "toolUse",
  "structuredOutput",
  "longContext",
  "embeddings",
  "rerank",
  "imageGeneration",
] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const SUBAGENT_CATEGORIES = ["read", "write", "knowledge", "orchestrator"] as const;
export type SubagentCategory = (typeof SUBAGENT_CATEGORIES)[number];

export const PERMISSION_MODES = ["allow", "ask", "deny"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const EXECUTOR_KINDS = ["opencode", "acp", "cli"] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

export const PROJECT_STATUSES = ["draft", "active", "paused", "completed", "failed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CONTRACT_VERIFICATIONS = ["command", "llm", "manual", "claims", "review"] as const;
export type ContractVerification = (typeof CONTRACT_VERIFICATIONS)[number];

export const CONTRACT_STATUSES = ["pending", "satisfied", "failed", "unknown"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const DOCUMENT_TYPES = ["reference", "generated", "image", "sketch"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_SOURCES = ["uploaded", "generated"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const INDEXED_STATUSES = ["pending", "indexed", "failed"] as const;
export type IndexedStatus = (typeof INDEXED_STATUSES)[number];

export const NODE_TYPES = [
  "start",
  "task",
  "gate",
  "join",
  "orchestrator",
  "condition",
  "loop",
  "subworkflow",
  "human_approval",
  "contract_check",
  "review_gate",
  "adr",
  "push_repo",
  "documentation",
  "notify",
  "end",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const JOIN_POLICIES = ["all", "any"] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

export const RUN_STATUSES = ["queued", "running", "paused", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = [
  "pending",
  "ready",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const EVENT_LEVELS = ["debug", "info", "warn", "error"] as const;
export type EventLevel = (typeof EVENT_LEVELS)[number];

export const EVENT_SOURCES = ["orchestrator", "agent", "system", "tool"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const USAGE_KINDS = ["chat", "embedding", "rerank", "image"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export const MEMORY_SCOPES = ["project", "assistant", "agent"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const PROPOSAL_KINDS = ["features", "stack", "contracts", "objective", "workflow", "document"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ["pending", "accepted", "rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const ASSISTANT_ROLES = ["user", "assistant"] as const;
export type AssistantRole = (typeof ASSISTANT_ROLES)[number];

// --- Método/Karajan: gates, política y gobernanza ---

export const REPO_PROVIDERS = ["github", "gitlab", "other"] as const;
export type RepoProvider = (typeof REPO_PROVIDERS)[number];

export const GATE_KINDS = [
  "card-first",
  "rag-first",
  "bash-write",
  "discard",
  "governance",
  "commit-gate",
  "cross-lane",
  "attribution",
] as const;
export type GateKind = (typeof GATE_KINDS)[number];

export const POLICY_CLASSES = ["security", "quality", "process"] as const;
export type PolicyClass = (typeof POLICY_CLASSES)[number];

export const DECISION_OUTCOMES = ["allow", "deny", "exception"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const RULE_KINDS = ["deterministic", "judgment", "out-of-scope"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const CLAIM_STATUSES = ["backed", "unbacked", "disproven"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const ADR_STATUSES = ["proposed", "accepted", "superseded", "rejected"] as const;
export type AdrStatus = (typeof ADR_STATUSES)[number];

export const CONTAINER_STATUSES = ["stopped", "starting", "running", "error"] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

export const CONTAINER_NETWORK_MODES = ["closed", "allowlist", "open"] as const;
export type ContainerNetworkMode = (typeof CONTAINER_NETWORK_MODES)[number];

export const BOARD_BACKENDS = ["internal", "external"] as const;
export type BoardBackend = (typeof BOARD_BACKENDS)[number];
