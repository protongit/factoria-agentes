import type { ExecutorKind, Harness } from "@factoria/shared";

export interface AgentModelRef {
  providerID: string;
  modelID: string;
}

export interface AgentRunContext {
  runId: string;
  stepRunId: string;
  /** Directorio de trabajo del proyecto donde el agente opera. */
  workspaceDir: string;
  prompt: string;
  system?: string;
  model?: AgentModelRef;
  harness: Harness;
  /** Instrucciones del subagente asignado al paso (si aplica). */
  subagentInstructions?: string;
  onEvent: (event: AgentEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export type AgentEventType =
  | "log"
  | "text"
  | "reasoning"
  | "tool"
  | "usage"
  | "diff"
  | "done"
  | "error";

export interface AgentEvent {
  type: AgentEventType;
  message?: string;
  payload?: unknown;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  cost?: number;
}

export interface AgentRunResult {
  status: "succeeded" | "failed";
  output: string;
  sessionRef?: string;
  diff?: string;
  usage?: AgentUsage;
  error?: string;
}

export interface AgentRunHandle {
  id: string;
  sessionRef?: string;
  result: Promise<AgentRunResult>;
  abort(): Promise<void>;
}

export interface ExecutorCapabilities {
  parallelSessions: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  sessions: boolean;
  resume: boolean;
  worktrees: boolean;
}

export interface AgentExecutor {
  readonly name: string;
  readonly kind: ExecutorKind;
  capabilities(): ExecutorCapabilities;
  /** Inicia una ejecución y devuelve un handle para observar/abortar. */
  run(ctx: AgentRunContext): Promise<AgentRunHandle>;
  /** Reanuda una sesión existente por su referencia (durabilidad). */
  resume?(sessionRef: string, ctx: AgentRunContext): Promise<AgentRunHandle>;
  /** Detiene cualquier recurso del ejecutor (p. ej. el servidor). */
  dispose?(): Promise<void>;
}
