import { db, projects, runEvents, runSummaries, projectBudgets, stepRuns, traceSpans, usageRecords, workflowEdges, workflowNodes, workflowRuns } from "@factoria/db";
import IORedis from "ioredis";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { enqueueRun } from "../lib/queue.ts";
import { publishControl } from "../lib/control.ts";
import { sql } from "drizzle-orm";

async function assertBudget(projectId: string): Promise<string | null> {
  const [budget] = await db.select().from(projectBudgets).where(eq(projectBudgets.projectId, projectId)).limit(1);
  if (!budget?.limitUsd) return null;
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${usageRecords.cost}), 0)` })
    .from(usageRecords)
    .where(eq(usageRecords.projectId, projectId));
  return Number(rows[0]?.total ?? 0) >= Number(budget.limitUsd) ? `Presupuesto agotado (${budget.limitUsd} USD)` : null;
}

async function postWebhook(url: string, payload: unknown): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function runRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/projects/:id/runs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.ownerId, request.user.sub)))
      .limit(1);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    return db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.projectId, id), eq(workflowRuns.kind, "flow")))
      .orderBy(desc(workflowRuns.createdAt));
  });

  app.post("/projects/:id/runs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.ownerId, request.user.sub)))
      .limit(1);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const workflowId = (request.body as { workflowId?: string }).workflowId ?? project.workflowId;
    if (!workflowId) return reply.code(400).send({ error: "El proyecto no tiene flujo de trabajo asignado" });

    const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
    if (nodes.length === 0) return reply.code(400).send({ error: "El flujo no tiene nodos" });
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

    const snapshot = {
      nodes: nodes.map((n) => ({
        key: n.key,
        type: n.type,
        name: n.name,
        description: n.description,
        modelId: n.modelId,
        subagentId: n.subagentId,
        expectedResult: n.expectedResult,
        harness: n.harness,
        workingDir: n.workingDir,
        joinPolicy: n.joinPolicy,
        loopGuard: n.loopGuard,
        usesWorkflowId: n.usesWorkflowId,
        dataMapping: n.dataMapping,
        disabled: n.disabled,
      })),
      edges: edges.map((e) => ({ fromNodeKey: e.fromNodeKey, toNodeKey: e.toNodeKey, condition: e.condition })),
    };

    const budgetErr = await assertBudget(id);
    if (budgetErr) return reply.code(402).send({ error: budgetErr });

    const [run] = await db
      .insert(workflowRuns)
      .values({ projectId: id, workflowId, graphSnapshot: snapshot as never, status: "queued", triggeredBy: request.user.sub })
      .returning();
    if (!run) return reply.code(500).send({ error: "No se pudo crear la ejecución" });
    await enqueueRun(run.id, id);
    return reply.code(201).send(run);
  });

  app.get("/runs/:runId", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!run) return reply.code(404).send({ error: "Ejecución no encontrada" });
    const steps = await db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).orderBy(asc(stepRuns.startedAt));
    return { ...run, steps };
  });

  app.get("/runs/:runId/events", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const sinceSeq = Number((request.query as { sinceSeq?: string }).sinceSeq ?? 0);
    return db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, sinceSeq)))
      .orderBy(asc(runEvents.seq));
  });

  app.get("/runs/:runId/usage", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const records = await db.select().from(usageRecords).where(eq(usageRecords.runId, runId));
    const totals = records.reduce(
      (acc, r) => {
        acc.inputTokens += r.inputTokens;
        acc.outputTokens += r.outputTokens;
        acc.cost += Number(r.cost);
        return acc;
      },
      { inputTokens: 0, outputTokens: 0, cost: 0 },
    );
    return { totals, count: records.length };
  });

  // SSE: histórico desde sinceSeq + stream en vivo (Redis pub/sub).
  app.get("/runs/:runId/stream", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const sinceSeq = Number((request.query as { sinceSeq?: string }).sinceSeq ?? 0);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const history = await db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, sinceSeq)))
      .orderBy(asc(runEvents.seq));
    for (const event of history) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const subscriber = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
    await subscriber.subscribe(`run:${runId}`);
    subscriber.on("message", (_channel, message) => {
      reply.raw.write(`data: ${message}\n\n`);
    });

    const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 15000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      void subscriber.quit();
    });
  });

  app.get("/runs/:runId/traces", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    return db.select().from(traceSpans).where(eq(traceSpans.runId, runId)).orderBy(asc(traceSpans.startedAt));
  });

  app.get("/runs/:runId/summary", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    return db.select().from(runSummaries).where(eq(runSummaries.runId, runId)).orderBy(desc(runSummaries.createdAt));
  });

  app.post("/runs/:runId/pause", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    await db.update(workflowRuns).set({ status: "paused" }).where(eq(workflowRuns.id, runId));
    await publishControl(runId, "pause");
    return { ok: true };
  });

  app.post("/runs/:runId/resume", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!run) return reply.code(404).send({ error: "Ejecución no encontrada" });
    await db.update(workflowRuns).set({ status: "running" }).where(eq(workflowRuns.id, runId));
    await enqueueRun(run.id, run.projectId, `resume-${run.id}-${Date.now()}`);
    return { ok: true };
  });

  app.post("/runs/:runId/approve", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { stepRunId?: string; approved?: boolean };
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!run) return reply.code(404).send({ error: "Ejecución no encontrada" });
    if (body.stepRunId) {
      await db
        .update(stepRuns)
        .set({ status: body.approved === false ? "failed" : "succeeded", finishedAt: new Date() })
        .where(and(eq(stepRuns.id, body.stepRunId), eq(stepRuns.runId, runId)));
    }
    // Reanuda el run tras la aprobación.
    await db.update(workflowRuns).set({ status: "running" }).where(eq(workflowRuns.id, runId));
    await enqueueRun(run.id, run.projectId, `resume-${run.id}-${Date.now()}`);
    return { ok: true };
  });

  // Reejecuta desde un nodo: hereda los estados conseguidos hasta ese punto.
  app.post("/runs/:runId/replay", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const { fromNodeKey } = request.body as { fromNodeKey?: string };
    const [source] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!source) return reply.code(404).send({ error: "Ejecución no encontrada" });
    if (!fromNodeKey) return reply.code(400).send({ error: "Falta fromNodeKey" });

    const snapshot = source.graphSnapshot as { nodes: { key: string }[]; edges: { fromNodeKey: string; toNodeKey: string }[] };
    const forwardReach = new Set<string>([fromNodeKey]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of snapshot.edges) {
        if (forwardReach.has(e.fromNodeKey) && !forwardReach.has(e.toNodeKey)) {
          forwardReach.add(e.toNodeKey);
          grew = true;
        }
      }
    }

    const [run] = await db
      .insert(workflowRuns)
      .values({
        projectId: source.projectId,
        workflowId: source.workflowId,
        graphSnapshot: source.graphSnapshot,
        status: "queued",
        triggeredBy: request.user.sub,
        sourceRunId: source.id,
      })
      .returning();
    if (!run) return reply.code(500).send({ error: "No se pudo crear el replay" });

    const sourceSteps = await db.select().from(stepRuns).where(eq(stepRuns.runId, runId));
    const toCopy = sourceSteps.filter((st) => !forwardReach.has(st.nodeKey));
    if (toCopy.length > 0) {
      await db.insert(stepRuns).values(
        toCopy.map((st) => ({
          runId: run.id,
          nodeKey: st.nodeKey,
          iteration: st.iteration,
          status: st.status,
          subagentId: st.subagentId ?? undefined,
          modelId: st.modelId ?? undefined,
          executor: st.executor,
          sessionRef: st.sessionRef,
          verdict: st.verdict ?? undefined,
          attempts: st.attempts,
          startedAt: st.startedAt ?? undefined,
          finishedAt: st.finishedAt ?? undefined,
        })),
      );
    }
    await enqueueRun(run.id, source.projectId, `replay-${run.id}-${Date.now()}`);
    return reply.code(201).send(run);
  });

  // Export de trazas en formato OTLP/JSON.
  app.get("/runs/:runId/traces/otel", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const spans = await db.select().from(traceSpans).where(eq(traceSpans.runId, runId)).orderBy(asc(traceSpans.startedAt));
    const toNs = (d?: Date | null) => `${(d?.getTime() ?? 0) * 1_000_000}`;
    const idHex = (u: string, n = 16) => u.replaceAll("-", "").slice(0, n);
    const byParent = new Map<string | null, typeof spans>();
    for (const sp of spans) {
      const k = sp.parentId ?? null;
      byParent.set(k, [...(byParent.get(k) ?? []), sp]);
    }
    const convert = (list: typeof spans): unknown[] =>
      list.flatMap((sp) => {
        const children = convert(byParent.get(sp.id) ?? []);
        return [{
          traceId: idHex(runId, 32),
          spanId: idHex(sp.id, 16),
          parentSpanId: sp.parentId ? idHex(sp.parentId, 16) : "",
          name: sp.name,
          kind: 1,
          startTimeUnixNano: toNs(sp.startedAt),
          endTimeUnixNano: toNs(sp.endedAt),
          attributes: [
            { key: "kind", value: { stringValue: sp.kind } },
            { key: "tokens", value: { intValue: String(sp.inputTokens + sp.outputTokens) } },
            { key: "cost", value: { stringValue: sp.cost } },
          ],
          ...(children.length ? { childSpans: children } : {}),
        }];
      });
    return { resourceSpans: [{ scopeSpans: [{ spans: convert(byParent.get(null) ?? []) }] }] };
  });

  // Probar un nodo aislado (n8n Test step): crea un run efímero kind='test'.
  app.post("/projects/:id/nodes/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.ownerId, request.user.sub)))
      .limit(1);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const node = request.body as Record<string, unknown>;
    if (!node?.key) return reply.code(400).send({ error: "Falta el nodo" });

    const snapshot = { nodes: [node], edges: [] };
    const [run] = await db
      .insert(workflowRuns)
      .values({ projectId: id, kind: "test", graphSnapshot: snapshot as never, status: "queued", triggeredBy: request.user.sub })
      .returning();
    if (!run) return reply.code(500).send({ error: "No se pudo crear la prueba" });
    await enqueueRun(run.id, id, `test-${run.id}-${Date.now()}`);
    return reply.code(201).send(run);
  });

  app.post("/runs/:runId/cancel", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    await db.update(workflowRuns).set({ status: "cancelled", finishedAt: new Date() }).where(eq(workflowRuns.id, runId));
    await publishControl(runId, "cancel");
    return { ok: true };
  });
}
