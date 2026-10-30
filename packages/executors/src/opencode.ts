import type {
  AgentEvent,
  AgentExecutor,
  AgentRunContext,
  AgentRunHandle,
  AgentRunResult,
  ExecutorCapabilities,
} from "./types.ts";

/**
 * Ejecutor primario basado en opencode.
 *
 * Se conecta a un servidor opencode ya en marcha (OPENCODE_URL) o levanta uno
 * propio, crea una sesión en el directorio de trabajo, envía el prompt con el
 * modelo asignado y reenvía los eventos (SSE) al orquestador.
 *
 * El SDK se importa de forma dinámica para no acoplar el typecheck del
 * monorepo a su superficie exacta.
 */
export class OpenCodeExecutor implements AgentExecutor {
  readonly name = "opencode";
  readonly kind = "opencode" as const;

  capabilities(): ExecutorCapabilities {
    return {
      parallelSessions: true,
      streaming: true,
      structuredOutput: true,
      sessions: true,
      resume: true,
      worktrees: true,
    };
  }

  private async client(directory?: string): Promise<any> {
    const sdk: any = await import("@opencode-ai/sdk");
    if (process.env.OPENCODE_URL) {
      return sdk.createOpencodeClient({
        baseUrl: process.env.OPENCODE_URL,
        ...(directory ? { directory } : {}),
      });
    }
    return (await sdk.createOpencode()).client;
  }

  async run(ctx: AgentRunContext): Promise<AgentRunHandle> {
    const client = await this.client(ctx.workspaceDir);
    const session = await client.session.create({ body: { title: `run:${ctx.runId} step:${ctx.stepRunId}` } });
    const sessionId: string = session?.id ?? session?.data?.id;

    const abortController = new AbortController();
    const signal = ctx.signal ?? abortController.signal;
    const result = this.execute(client, sessionId, ctx, signal);

    return {
      id: sessionId,
      sessionRef: sessionId,
      result,
      async abort() {
        abortController.abort();
        try {
          await client.session.abort({ path: { id: sessionId } });
        } catch {
          /* best-effort */
        }
      },
    };
  }

  async resume(sessionRef: string, ctx: AgentRunContext): Promise<AgentRunHandle> {
    const client = await this.client(ctx.workspaceDir);
    const abortController = new AbortController();
    const signal = ctx.signal ?? abortController.signal;
    const result = this.execute(client, sessionRef, ctx, signal);
    return {
      id: sessionRef,
      sessionRef,
      result,
      async abort() {
        abortController.abort();
      },
    };
  }

  private async execute(
    client: any,
    sessionId: string,
    ctx: AgentRunContext,
    signal: AbortSignal,
  ): Promise<AgentRunResult> {
    const emit = (event: AgentEvent) => void ctx.onEvent(event);
    const messageRoles = new Map<string, string>();
    const emittedChars = new Map<string, number>();
    let assistantSeen = false;
    let output = "";
    let usage: AgentRunResult["usage"];
    let streamError: string | null = null;

    const captureError = (error: unknown) => {
      if (!error) return;
      const message =
        typeof error === "string"
          ? error
          : (error as { message?: string; name?: string }).message ??
            (error as { name?: string }).name ??
            JSON.stringify(error);
      if (message) streamError = message;
    };

    const emitDelta = (kind: "text" | "reasoning", part: { id?: string; text?: string }, text: string) => {
      const key = `${kind}:${part.id ?? "anonymous"}`;
      const previous = emittedChars.get(key) ?? 0;
      const delta = text.slice(previous);
      if (!delta) return;
      emittedChars.set(key, text.length);
      if (kind === "text") output += delta;
      emit({ type: kind, message: delta, payload: { ...part, text: delta } });
    };

    // Consumo de eventos en segundo plano (no bloquea el envío del prompt).
    void (async () => {
      try {
        const events = await client.event.subscribe();
        for await (const event of events.stream ?? []) {
          if (signal.aborted) break;
          const props = event?.properties ?? {};
          if (props.sessionID && props.sessionID !== sessionId) continue;

          const info = props.info;
          if (info?.id && info?.role) messageRoles.set(info.id, info.role);
          if (info?.role === "assistant") {
            assistantSeen = true;
            if (info?.error) captureError(info.error);
          }
          if (info?.tokens) {
            usage = {
              inputTokens: info.tokens.input ?? 0,
              outputTokens: info.tokens.output ?? 0,
              reasoningTokens: info.tokens.reasoning ?? undefined,
              cost: info.cost,
            };
            emit({ type: "usage", payload: usage });
          }

          const part = props.part;
          if (!part) continue;
          const role = part.messageID ? messageRoles.get(part.messageID) : undefined;
          // Descarta el eco del prompt del usuario y partes de rol desconocido
          // hasta que el mensaje del asistente haya aparecido.
          const fromAssistant = role === "assistant" || (role === undefined && assistantSeen);
          if (!fromAssistant) continue;

          if (part.type === "text" && typeof part.text === "string") {
            emitDelta("text", part, part.text);
          } else if (part.type === "reasoning" && typeof part.text === "string") {
            emitDelta("reasoning", part, part.text);
          } else if (part.type === "tool") {
            const state = part.state ?? {};
            const status = String(state.status ?? "");
            emit({
              type: "tool",
              message: `${part.tool ?? "tool"}${status ? ` (${status})` : ""}`,
              payload: {
                tool: part.tool,
                title: part.title,
                status,
                input: state.input,
                output: state.output,
                error: state.error,
              },
            });
          }
        }
      } catch {
        /* el stream puede cerrarse al terminar */
      }
    })();

    const attempts = Math.max(1, Number(process.env.AGENT_PROMPT_RETRIES ?? 2));
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      streamError = null;
      try {
        const res = await client.session.prompt({
          path: { id: sessionId },
          body: {
            model: ctx.model,
            system: ctx.system,
            parts: [{ type: "text", text: ctx.prompt }],
          },
        });
        const data = res?.data ?? res;
        if (data?.info?.error) captureError(data.info.error);
        if (res?.error && !streamError) captureError(res.error);

        // Fallback: si el stream no entregó texto, usa las partes finales del assistant.
        if (!output) {
          const parts = Array.isArray(data?.parts) ? data.parts : [];
          const text = parts
            .filter((p: { type?: string }) => p?.type === "text")
            .map((p: { text?: string }) => p.text ?? "")
            .join("");
          if (text) output = text;
        }

        if (!streamError) {
          emit({ type: "done", message: "completed" });
          return { status: "succeeded", output, sessionRef: sessionId, usage };
        }
        lastError = streamError;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      const transient = /fetch failed|timeout|econn|etimedout|network|overloaded|429|5\d\d/i.test(lastError ?? "");
      if (attempt < attempts && transient && !output) {
        emit({ type: "log", message: `Reintentando tras error transitorio (${attempt}/${attempts}): ${lastError}` });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      emit({ type: "error", message: lastError ?? "error desconocido" });
      return { status: "failed", output, sessionRef: sessionId, usage, error: lastError ?? "error desconocido" };
    }

    emit({ type: "error", message: lastError ?? "error desconocido" });
    return { status: "failed", output, sessionRef: sessionId, usage, error: lastError ?? "error desconocido" };
  }
}
