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
    const idleWaiter: { resolve: (() => void) | null } = { resolve: null };
    const sessionParents = new Map<string, string | null>();

    const captureError = (error: unknown) => {
      if (!error) return;
      const message =
        typeof error === "string"
          ? error
          : (error as { data?: { message?: string }; message?: string; name?: string }).data?.message ??
            (error as { message?: string; name?: string }).message ??
            (error as { name?: string }).name ??
            JSON.stringify(error);
      if (message) streamError = message;
    };

    /** ¿La sesión pertenece a esta ejecución? (la principal o una hija creada por `task`). */
    const isOurSession = async (sid: string): Promise<boolean> => {
      if (!sid) return false;
      const seen = new Set<string>();
      let current: string | null = sid;
      while (current && !seen.has(current)) {
        if (current === sessionId) return true;
        seen.add(current);
        if (!sessionParents.has(current)) {
          try {
            const res = await client.session.get({ path: { id: current } });
            const data = res?.data ?? res;
            sessionParents.set(current, data?.parentID ?? null);
          } catch {
            sessionParents.set(current, null);
          }
        }
        current = sessionParents.get(current) ?? null;
      }
      return false;
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
    // No usamos `session.prompt` bloqueante: la petición HTTP esperaba el turno
    // completo y superaba el timeout de 300 s de undici en turnos largos.
    void (async () => {
      try {
        const events = await client.event.subscribe();
        for await (const event of events.stream ?? []) {
          if (signal.aborted) break;
          const type = event?.type;
          const props = event?.properties ?? {};

          // Solicitudes de permiso: se responden siempre para que el turno no
          // quede colgado esperando una decisión humana que aquí no existe.
          if (type === "permission.updated") {
            const perm = props as { id?: string; sessionID?: string; type?: string; pattern?: string | string[]; title?: string };
            if (perm.sessionID && perm.id && (await isOurSession(perm.sessionID))) {
              const decision = await (ctx.onPermission?.({
                type: String(perm.type ?? "desconocido"),
                pattern: perm.pattern,
                title: perm.title,
                sessionID: perm.sessionID,
              }) ?? "reject");
              try {
                await client.postSessionIdPermissionsPermissionId({
                  path: { id: perm.sessionID, permissionID: perm.id },
                  body: { response: decision },
                });
                emit({
                  type: "log",
                  message: `Permiso «${perm.type ?? "desconocido"}» ${decision === "reject" ? "denegado" : "concedido"}${perm.pattern ? ` (${Array.isArray(perm.pattern) ? perm.pattern.join(", ") : perm.pattern})` : ""}`,
                });
              } catch (error) {
                emit({ type: "log", message: `No se pudo responder al permiso: ${error instanceof Error ? error.message : String(error)}` });
              }
            }
            continue;
          }

          if (props.sessionID && props.sessionID !== sessionId) continue;

          if (type === "session.idle") {
            idleWaiter.resolve?.();
            idleWaiter.resolve = null;
            continue;
          }

          if (type === "session.status" && props.status?.type === "retry") {
            emit({ type: "log", message: `El proveedor reintenta (intento ${props.status.attempt}): ${props.status.message}` });
            continue;
          }

          if (type === "session.error") {
            captureError(props.error);
            continue;
          }

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
    const stepTimeoutMs = Math.max(60000, Number(process.env.AGENT_STEP_TIMEOUT ?? 1800000));
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      streamError = null;
      const idle = new Promise<"idle">((resolve) => {
        idleWaiter.resolve = () => resolve("idle");
      });

      try {
        const res = await client.session.promptAsync({
          path: { id: sessionId },
          body: {
            model: ctx.model,
            system: ctx.system,
            parts: [{ type: "text", text: ctx.prompt }],
          },
        });
        if (res?.error) captureError(res.error);
      } catch (error) {
        idleWaiter.resolve = null;
        lastError = error instanceof Error ? error.message : String(error);
        const transient = /fetch failed|timeout|econn|etimedout|network|overloaded|429|5\d\d/i.test(lastError);
        if (attempt < attempts && transient) {
          emit({ type: "log", message: `Reintentando el envío del prompt (${attempt}/${attempts}): ${lastError}` });
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        emit({ type: "error", message: lastError });
        return { status: "failed", output, sessionRef: sessionId, usage, error: lastError };
      }

      const timedOut = Symbol("timeout");
      const outcome = await Promise.race([
        idle.then(() => "idle" as const),
        new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), stepTimeoutMs)),
      ]);
      idleWaiter.resolve = null;

      if (outcome === timedOut) {
        lastError = `El agente superó el tiempo máximo de ${Math.round(stepTimeoutMs / 60000)} min sin terminar; la sesión se ha cancelado.`;
        try {
          await client.session.abort({ path: { id: sessionId } });
        } catch {
          /* best-effort */
        }
        emit({ type: "error", message: lastError });
        return { status: "failed", output, sessionRef: sessionId, usage, error: lastError };
      }

      // Fallback: si el stream no entregó texto, usa el último mensaje del assistant.
      if (!output) {
        output = await lastAssistantText(client, sessionId);
      }

      if (!streamError) {
        emit({ type: "done", message: "completed" });
        return { status: "succeeded", output, sessionRef: sessionId, usage };
      }

      lastError = streamError;
      emit({ type: "error", message: lastError });
      return { status: "failed", output, sessionRef: sessionId, usage, error: lastError };
    }

    emit({ type: "error", message: lastError ?? "error desconocido" });
    return { status: "failed", output, sessionRef: sessionId, usage, error: lastError ?? "error desconocido" };
  }
}

/** Recupera el texto del último mensaje del asistente si el stream no lo entregó. */
async function lastAssistantText(client: any, sessionId: string): Promise<string> {
  try {
    const res = await client.session.messages({ path: { id: sessionId } });
    const list = res?.data ?? res;
    if (!Array.isArray(list)) return "";
    const assistants = list.filter((m: any) => m?.info?.role === "assistant");
    const last = assistants[assistants.length - 1];
    const parts = Array.isArray(last?.parts) ? last.parts : [];
    return parts
      .filter((p: any) => p?.type === "text")
      .map((p: any) => p.text ?? "")
      .join("");
  } catch {
    return "";
  }
}
