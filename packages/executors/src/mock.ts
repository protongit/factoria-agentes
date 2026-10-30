import type {
  AgentExecutor,
  AgentRunContext,
  AgentRunHandle,
  AgentRunResult,
  ExecutorCapabilities,
} from "./types.ts";

/**
 * Ejecutor simulado: no llama a ningún modelo real. Emite eventos de progreso
 * y devuelve un resultado determinista. Se usa cuando no hay proveedor/modelo
 * configurado (demostraciones y pruebas de los flujos de orquestación).
 */
export class MockExecutor implements AgentExecutor {
  readonly name = "mock";
  readonly kind = "opencode" as const;

  constructor(private readonly delayMs = 400) {}

  capabilities(): ExecutorCapabilities {
    return {
      parallelSessions: true,
      streaming: true,
      structuredOutput: true,
      sessions: true,
      resume: false,
      worktrees: false,
    };
  }

  async run(ctx: AgentRunContext): Promise<AgentRunHandle> {
    const emit = ctx.onEvent;
    const abortController = new AbortController();
    const signal = ctx.signal ?? abortController.signal;

    const result = (async (): Promise<AgentRunResult> => {
      const lines = [
        `Analizando la tarea: ${ctx.prompt.slice(0, 120)}`,
        `Modelo: ${ctx.model ? `${ctx.model.providerID}/${ctx.model.modelID}` : "sin modelo (mock)"}`,
        `Directorio de trabajo: ${ctx.workspaceDir}`,
        "Aplicando cambios…",
        "Revisando el resultado…",
      ];
      let output = "";
      for (const line of lines) {
        if (signal.aborted) break;
        await new Promise((r) => setTimeout(r, this.delayMs));
        output += line + "\n";
        await emit({ type: "text", message: line });
      }
      await emit({ type: "done", message: "Paso completado (mock)" });
      return {
        status: "succeeded",
        output,
        sessionRef: `mock:${ctx.stepRunId}`,
        usage: { inputTokens: 320, outputTokens: 180, cost: 0 },
      };
    })();

    return {
      id: `mock:${ctx.stepRunId}`,
      sessionRef: `mock:${ctx.stepRunId}`,
      result,
      async abort() {
        abortController.abort();
      },
    };
  }
}
