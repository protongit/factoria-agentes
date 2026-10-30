import { spawn } from "node:child_process";
import type {
  AgentEvent,
  AgentExecutor,
  AgentRunContext,
  AgentRunHandle,
  AgentRunResult,
  ExecutorCapabilities,
} from "./types.ts";

/**
 * Ejecutor CLI genérico: lanza un comando plantilla (p. ej. pi agent) y captura
 * su salida.
 *
 * Plantilla por defecto: `{command} {prompt}`. Variables soportadas:
 * `{prompt}`, `{model}`, `{dir}`.
 */
export class CliExecutor implements AgentExecutor {
  readonly name = "cli";
  readonly kind = "cli" as const;

  constructor(private readonly template = process.env.CLI_AGENT_TEMPLATE ?? "") {}

  capabilities(): ExecutorCapabilities {
    return {
      parallelSessions: true,
      streaming: true,
      structuredOutput: false,
      sessions: false,
      resume: false,
      worktrees: false,
    };
  }

  async run(ctx: AgentRunContext): Promise<AgentRunHandle> {
    if (!this.template) {
      throw new Error(
        "CliExecutor sin plantilla. Define CLI_AGENT_TEMPLATE, p. ej. 'pi --model {model} --print {prompt}'.",
      );
    }

    const model = ctx.model ? `${ctx.model.providerID}/${ctx.model.modelID}` : "";
    const line = this.template
      .replaceAll("{prompt}", ctx.prompt)
      .replaceAll("{model}", model)
      .replaceAll("{dir}", ctx.workspaceDir);

    const [command, ...args] = line.split(" ").filter(Boolean);
    const child = spawn(command ?? "", args, { cwd: ctx.workspaceDir, stdio: ["ignore", "pipe", "pipe"] });
    const emit = (event: AgentEvent) => void ctx.onEvent(event);

    const result = new Promise<AgentRunResult>((resolve) => {
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        output += text;
        emit({ type: "text", payload: text });
      });
      child.stderr.on("data", (chunk: Buffer) => emit({ type: "log", message: chunk.toString() }));
      child.on("error", (error) => {
        emit({ type: "error", message: error.message });
        resolve({ status: "failed", output, error: error.message });
      });
      child.on("close", (code) => {
        emit({ type: "done", message: `exit ${code ?? 0}` });
        resolve({
          status: code === 0 ? "succeeded" : "failed",
          output,
          error: code === 0 ? undefined : `cli exited with code ${code}`,
        });
      });
    });

    return {
      id: `cli:${ctx.stepRunId}`,
      result,
      async abort() {
        child.kill("SIGTERM");
      },
    };
  }
}
