import type { ExecutorKind } from "@factoria/shared";
import { AcpExecutor } from "./acp.ts";
import { CliExecutor } from "./cli.ts";
import { MockExecutor } from "./mock.ts";
import { OpenCodeExecutor } from "./opencode.ts";
import type { AgentExecutor } from "./types.ts";

export * from "./types.ts";
export { OpenCodeExecutor } from "./opencode.ts";
export { AcpExecutor } from "./acp.ts";
export { CliExecutor } from "./cli.ts";
export { MockExecutor } from "./mock.ts";

/** Devuelve el ejecutor correspondiente a un tipo. */
export function getExecutor(kind: ExecutorKind): AgentExecutor {
  switch (kind) {
    case "acp":
      return new AcpExecutor();
    case "cli":
      return new CliExecutor();
    case "opencode":
    default:
      return new OpenCodeExecutor();
  }
}

/**
 * Resuelve el ejecutor a usar. `opencode` requiere un servidor accesible
 * (OPENCODE_URL) y sin él cae al simulado; ACP y CLI son siempre reales.
 */
export function resolveExecutor(kind: ExecutorKind): AgentExecutor {
  if (kind === "opencode") {
    if (process.env.OPENCODE_URL || process.env.OPENCODE_ENABLE_REAL === "1") return getExecutor(kind);
    return new MockExecutor();
  }
  return getExecutor(kind);
}

