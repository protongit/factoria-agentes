import { z } from "zod";
import {
  ADR_STATUSES,
  BOARD_BACKENDS,
  CONTAINER_NETWORK_MODES,
  CONTRACT_VERIFICATIONS,
  EXECUTOR_KINDS,
  GATE_KINDS,
  JOIN_POLICIES,
  MODEL_CAPABILITIES,
  NODE_TYPES,
  PERMISSION_MODES,
  POLICY_CLASSES,
  REPO_PROVIDERS,
  SUBAGENT_CATEGORIES,
  USER_ROLES,
} from "./enums.ts";

export const idSchema = z.string().min(1);

export const userRoleSchema = z.enum(USER_ROLES);
export const modelCapabilitySchema = z.enum(MODEL_CAPABILITIES);
export const subagentCategorySchema = z.enum(SUBAGENT_CATEGORIES);
export const permissionModeSchema = z.enum(PERMISSION_MODES);
export const executorKindSchema = z.enum(EXECUTOR_KINDS);
export const nodeTypeSchema = z.enum(NODE_TYPES);
export const joinPolicySchema = z.enum(JOIN_POLICIES);
export const contractVerificationSchema = z.enum(CONTRACT_VERIFICATIONS);
export const repoProviderSchema = z.enum(REPO_PROVIDERS);
export const containerNetworkModeSchema = z.enum(CONTAINER_NETWORK_MODES);
export const gateKindSchema = z.enum(GATE_KINDS);
export const policyClassSchema = z.enum(POLICY_CLASSES);
export const adrStatusSchema = z.enum(ADR_STATUSES);
export const boardBackendSchema = z.enum(BOARD_BACKENDS);

// --- Auth ---

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// --- Proveedores y modelos ---

export const createProviderSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
});

export const createModelSchema = z.object({
  providerId: idSchema,
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  contextWindow: z.number().int().positive().optional(),
  capabilities: z.array(modelCapabilitySchema).default([]),
  costInputPer1M: z.number().nonnegative().optional(),
  costOutputPer1M: z.number().nonnegative().optional(),
  enabled: z.boolean().default(true),
});

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type CreateModelInput = z.infer<typeof createModelSchema>;

// --- Subagentes ---

export const permissionsSchema = z
  .object({
    read: permissionModeSchema.default("allow"),
    edit: permissionModeSchema.default("deny"),
    bash: z.union([permissionModeSchema, z.record(z.string(), permissionModeSchema)]).default("deny"),
    webfetch: permissionModeSchema.default("deny"),
    task: z.union([permissionModeSchema, z.record(z.string(), permissionModeSchema)]).default("deny"),
  })
  .partial();

export const createSubagentSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  category: subagentCategorySchema,
  defaultModelId: idSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  permissions: permissionsSchema.default({}),
  allowedTools: z.array(z.string()).default([]),
  outputContract: z.string().optional(),
  canDelegateTo: z.array(idSchema).default([]),
  maxDepth: z.number().int().min(0).default(1),
  skills: z.array(z.string()).default([]),
  mcpServers: z.array(z.string()).default([]),
  mode: z.enum(["subagent", "primary"]).default("subagent"),
});

export type CreateSubagentInput = z.infer<typeof createSubagentSchema>;
export type Permissions = z.infer<typeof permissionsSchema>;

// --- Harness ---

export const harnessSchema = z.object({
  executor: executorKindSchema.default("opencode"),
  agentProfile: z.string().default("build"),
  subagentId: idSchema.optional(),
  permissions: permissionsSchema.optional(),
  mcpServers: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  rag: z
    .object({
      enabled: z.boolean().default(true),
      topK: z.number().int().positive().default(8),
      rerank: z.boolean().default(true),
    })
    .optional(),
  condition: z
    .object({
      field: z.string().optional(),
      op: z.enum(["contains", "not_contains", "equals", "regex", "truthy"]).optional(),
      value: z.string().optional(),
      expr: z.string().optional(),
      prompt: z.string().optional(),
    })
    .optional(),
  rules: z
    .object({
      allowNetwork: z.boolean().default(false),
      workspaceOnly: z.boolean().default(true),
      worktree: z.boolean().default(false),
    })
    .optional(),
  gates: z.array(gateKindSchema).default([]),
  validationCommand: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type Harness = z.infer<typeof harnessSchema>;

// --- Proyecto ---

export const createProjectSchema = z.object({
  name: z.string().min(1),
  programName: z.string().min(1),
  objective: z.string().min(1),
  description: z.string().optional(),
  stack: z.array(z.string()).default([]),
  workspaceRoot: z.string().optional(),
  workflowId: idSchema.optional(),
  embeddingModelId: idSchema.optional(),
  rerankModelId: idSchema.optional(),
  assistantModelId: idSchema.optional(),
  assistantInstructions: z.string().optional(),
  defaultHarness: harnessSchema.optional(),
  repoProvider: repoProviderSchema.optional(),
  repoUrl: z.string().optional(),
  repoBranch: z.string().optional(),
  repoToken: z.string().optional(),
  containerImage: z.string().optional(),
  containerEnabled: z.boolean().optional(),
  containerNetworkMode: containerNetworkModeSchema.optional(),
  stateBackend: boardBackendSchema.optional(),
  boardName: z.string().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// --- Flujo ---

export const workflowNodeSchema = z.object({
  key: z.string().min(1),
  type: nodeTypeSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  modelId: idSchema.optional(),
  subagentId: idSchema.optional(),
  expectedResult: z.string().optional(),
  harness: harnessSchema.optional(),
  workingDir: z.string().default("."),
  joinPolicy: joinPolicySchema.default("all"),
  usesWorkflowId: idSchema.optional(),
  loopGuard: z
    .object({ maxIterations: z.number().int().positive().default(3) })
    .optional(),
  dataMapping: z.record(z.string(), z.string()).optional(),
  disabled: z.boolean().default(false),
  errorHandling: z.object({ continueOnFail: z.boolean().default(false) }).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const workflowEdgeSchema = z.object({
  fromNodeKey: z.string().min(1),
  toNodeKey: z.string().min(1),
  condition: z.record(z.string(), z.any()).optional(),
});

export const upsertWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  variables: z.record(z.string(), z.any()).optional(),
  nodes: z.array(workflowNodeSchema).default([]),
  edges: z.array(workflowEdgeSchema).default([]),
});

export type WorkflowNodeInput = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdgeInput = z.infer<typeof workflowEdgeSchema>;
export type UpsertWorkflowInput = z.infer<typeof upsertWorkflowSchema>;

// --- Método: veredictos, reglas, ADRs ---

export const reviewVerdictSchema = z.object({
  verdict: z.enum(["approved", "rejected"]),
  reviewerModelId: z.string().optional(),
  reviewerFamily: z.string().optional(),
  authorModelId: z.string().optional(),
  diffHash: z.string().min(1),
  summary: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  workspace: z.string().default("root"),
});

export const policyRuleSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  literalText: z.string().min(1),
  kind: z.enum(["deterministic", "judgment", "out-of-scope", "none"]).default("none"),
  klass: policyClassSchema.default("process"),
  gate: gateKindSchema.optional(),
  condition: z.record(z.string(), z.any()).optional(),
});

export const adrSchema = z.object({
  title: z.string().min(1),
  status: adrStatusSchema.default("proposed"),
  context: z.string().default(""),
  decision: z.string().min(1),
  consequences: z.string().default(""),
});

export type ReviewVerdictInput = z.infer<typeof reviewVerdictSchema>;
export type PolicyRuleInput = z.infer<typeof policyRuleSchema>;
export type AdrInput = z.infer<typeof adrSchema>;
