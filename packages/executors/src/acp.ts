import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  AgentEvent,
  AgentExecutor,
  AgentRunContext,
  AgentRunHandle,
  AgentRunResult,
  ExecutorCapabilities,
} from "./types.ts";

/**
 * Ejecutor ACP (Agent Client Protocol): habla JSON-RPC sobre stdio con un
 * agente compatible (p. ej. `opencode acp`). Métodos configurables por entorno
 * para adaptarse a variantes del protocolo.
 *
 *   ACP_COMMAND=opencode ACP_ARGS=acp
 *   ACP_NEW_SESSION=session/new  ACP_PROMPT=session/prompt
 */
export class AcpExecutor implements AgentExecutor {
  readonly name = "acp";
  readonly kind = "acp" as const;

  constructor(
    private readonly command = process.env.ACP_COMMAND ?? "opencode",
    private readonly args = (process.env.ACP_ARGS ?? "acp").split(" ").filter(Boolean),
  ) {}

  capabilities(): ExecutorCapabilities {
    return { parallelSessions: true, streaming: true, structuredOutput: false, sessions: true, resume: false, worktrees: false };
  }

  async run(ctx: AgentRunContext): Promise<AgentRunHandle> {
    const child = spawn(this.command, this.args, { cwd: ctx.workspaceDir, stdio: ["pipe", "pipe", "pipe"] });

    const emit = (event: AgentEvent) => void ctx.onEvent(event);
    const pending = new Map<number, (value: unknown) => void>();
    let rpcId = 0;
    let buffer = "";
    let sessionId = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; method?: string; result?: unknown; params?: unknown };
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)!(msg.result ?? msg);
            pending.delete(msg.id);
          } else if (msg.method) {
            emit({ type: "log", message: msg.method, payload: msg.params });
          }
        } catch { /* ignorar */ }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => emit({ type: "log", message: chunk.toString() }));

    const rpc = (method: string, params: Record<string, unknown>): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const id = ++rpcId;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timeout ACP en ${method}`));
        }, 180000);
        pending.set(id, (v) => { clearTimeout(timeout); resolve(v); });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });

    const result = (async (): Promise<AgentRunResult> => {
      let output = "";
      try {
        await rpc("initialize", {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        });
        const newSession = (await rpc(process.env.ACP_NEW_SESSION ?? "session/new", {
          cwd: ctx.workspaceDir,
          mcpServers: [],
        })) as { sessionId?: string; id?: string };
        sessionId = newSession?.sessionId ?? newSession?.id ?? "";
        const res = (await rpc(process.env.ACP_PROMPT ?? "session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: ctx.prompt }],
        })) as { text?: string; content?: string } | undefined;
        output = res?.text ?? res?.content ?? "ok";
        emit({ type: "done", message: "completado (ACP)" });
        return { status: "succeeded", output, sessionRef: sessionId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: "error", message });
        return { status: "failed", output, sessionRef: sessionId, error: message };
      } finally {
        child.kill("SIGTERM");
      }
    })();

    return {
      id: `acp:${ctx.stepRunId}`,
      get sessionRef() { return sessionId; },
      result,
      async abort() {
        child.kill("SIGTERM");
      },
    };
  }
}

export type { ChildProcessWithoutNullStreams };
