import { db, workflowEditHistory, workflowEdges, workflowNodes, workflowVersions, workflows } from "@factoria/db";
import { SYSTEM_TEMPLATES } from "../lib/templates.ts";
import { upsertWorkflowSchema } from "@factoria/shared";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const DEFAULT_TEMPLATE = {
  name: "Desarrollo con revisión (backend ‖ frontend)",
  description: "Dos ramas en paralelo (backend y frontend) que convergen en un revisor; si falla, vuelve a desarrollo; al aprobar, documenta.",
  nodes: [
    { key: "start", type: "start", name: "Inicio" },
    { key: "backend", type: "task", name: "Desarrollar backend", description: "Implementa la API y la lógica de negocio.", workingDir: "backend", expectedResult: "El backend compila y expone los endpoints." },
    { key: "frontend", type: "task", name: "Desarrollar frontend", description: "Implementa la interfaz de usuario.", workingDir: "frontend", expectedResult: "La interfaz arranca y consume la API." },
    { key: "review", type: "gate", name: "Revisar integración", description: "Comprueba la conexión entre backend y frontend y ejecuta los tests.", joinPolicy: "all" as const, expectedResult: "Los tests pasan y la integración es funcional." },
    { key: "document", type: "documentation", name: "Documentar", description: "Genera/actualiza el README y la documentación del proyecto.", workingDir: "." },
    { key: "end", type: "end", name: "Fin" },
  ],
  edges: [
    { fromNodeKey: "start", toNodeKey: "backend" },
    { fromNodeKey: "start", toNodeKey: "frontend" },
    { fromNodeKey: "backend", toNodeKey: "review" },
    { fromNodeKey: "frontend", toNodeKey: "review" },
    { fromNodeKey: "review", toNodeKey: "backend", condition: { on: "failure" } },
    { fromNodeKey: "review", toNodeKey: "document", condition: { on: "success" } },
    { fromNodeKey: "document", toNodeKey: "end" },
  ],
};

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/workflows", async (request) => {
    return db
      .select()
      .from(workflows)
      .where(eq(workflows.ownerId, request.user.sub))
      .orderBy(desc(workflows.createdAt));
  });

  app.get("/workflows/templates", async () => SYSTEM_TEMPLATES);

  app.get("/workflows/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [wf] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.ownerId, request.user.sub)))
      .limit(1);
    if (!wf) return reply.code(404).send({ error: "Flujo no encontrado" });
    const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, id));
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id));
    return { ...wf, nodes, edges };
  });

  app.post("/workflows", async (request, reply) => {
    const parsed = upsertWorkflowSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    const { name, description, nodes, edges, variables } = parsed.data;
    const [wf] = await db
      .insert(workflows)
      .values({ ownerId: request.user.sub, name, description, variables: (variables ?? {}) as never })
      .returning();
    if (!wf) return reply.code(500).send({ error: "No se pudo crear el flujo" });
    await persistGraph(wf.id, nodes, edges);
    await db.insert(workflowVersions).values({ workflowId: wf.id, version: 1, graph: { nodes, edges } });
    return reply.code(201).send({ ...wf, nodes, edges });
  });

  app.put("/workflows/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = upsertWorkflowSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    const [wf] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.ownerId, request.user.sub)))
      .limit(1);
    if (!wf) return reply.code(404).send({ error: "Flujo no encontrado" });
    const { name, description, nodes, edges, variables } = parsed.data;
    const newVersion = wf.version + 1;
    await db
      .update(workflows)
      .set({ name, description, variables: (variables ?? wf.variables ?? {}) as never, version: newVersion, updatedAt: new Date() })
      .where(eq(workflows.id, id));
    await persistGraph(id, nodes, edges);
    await db.insert(workflowVersions).values({ workflowId: id, version: newVersion, graph: { nodes, edges } });
    return { ...wf, name, description, version: newVersion, nodes, edges };
  });

  app.delete("/workflows/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(workflows).where(and(eq(workflows.id, id), eq(workflows.ownerId, request.user.sub)));
    return reply.code(204).send();
  });

  app.post("/workflows/from-template", async (request, reply) => {
    const [wf] = await db
      .insert(workflows)
      .values({ ownerId: request.user.sub, name: DEFAULT_TEMPLATE.name, description: DEFAULT_TEMPLATE.description })
      .returning();
    if (!wf) return reply.code(500).send({ error: "No se pudo crear el flujo" });
    await persistGraph(wf.id, SYSTEM_TEMPLATES[0]!.nodes as never, SYSTEM_TEMPLATES[0]!.edges as never);
    return reply.code(201).send(wf);
  });

  app.get("/workflows/:id/export", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [wf] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.ownerId, request.user.sub)))
      .limit(1);
    if (!wf) return reply.code(404).send({ error: "Flujo no encontrado" });
    const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, id));
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id));
    return {
      name: wf.name,
      description: wf.description,
      category: wf.category,
      variables: wf.variables,
      nodes: nodes.map((n) => ({
        key: n.key, type: n.type, name: n.name, description: n.description, modelId: n.modelId,
        subagentId: n.subagentId, expectedResult: n.expectedResult, harness: n.harness, workingDir: n.workingDir,
        joinPolicy: n.joinPolicy, loopGuard: n.loopGuard, dataMapping: n.dataMapping, disabled: n.disabled,
        errorHandling: n.errorHandling, position: n.position,
      })),
      edges: edges.map((e) => ({ fromNodeKey: e.fromNodeKey, toNodeKey: e.toNodeKey, condition: e.condition })),
    };
  });

  app.post("/workflows/import", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const parsed = upsertWorkflowSchema.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: "JSON de flujo inválido", details: parsed.error.flatten() });
    const { name, description, nodes, edges, variables, category } = parsed.data;
    const [wf] = await db
      .insert(workflows)
      .values({ ownerId: request.user.sub, name, description, category: category ?? null, variables: (variables ?? {}) as never })
      .returning();
    if (!wf) return reply.code(500).send({ error: "No se pudo importar el flujo" });
    await persistGraph(wf.id, nodes as never, edges as never);
    await db.insert(workflowVersions).values({ workflowId: wf.id, version: 1, graph: { nodes, edges } });
    return reply.code(201).send(wf);
  });

  app.get("/workflows/:id/history", async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db
      .select({ id: workflowEditHistory.id, createdAt: workflowEditHistory.createdAt })
      .from(workflowEditHistory)
      .where(eq(workflowEditHistory.workflowId, id))
      .orderBy(asc(workflowEditHistory.createdAt));
    return { entries: rows };
  });

  app.post("/workflows/:id/history/push", async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { snapshot?: unknown; currentIndex?: number };
    if (!b?.snapshot) return reply.code(400).send({ error: "Falta snapshot" });
    // Trunca la rama redo tras currentIndex (si hay redo pendiente tras un undo) y añade.
    if (typeof b.currentIndex === "number") {
      const rows = await db
        .select({ id: workflowEditHistory.id, createdAt: workflowEditHistory.createdAt })
        .from(workflowEditHistory)
        .where(eq(workflowEditHistory.workflowId, id))
        .orderBy(asc(workflowEditHistory.createdAt));
      const stale = rows.slice((b.currentIndex ?? 0) + 1).map((r) => r.id);
      if (stale.length) await db.delete(workflowEditHistory).where(inArray(workflowEditHistory.id, stale));
    }
    await db.insert(workflowEditHistory).values({ workflowId: id, userId: request.user.sub, snapshot: b.snapshot });
    const rows = await db
      .select({ id: workflowEditHistory.id, createdAt: workflowEditHistory.createdAt })
      .from(workflowEditHistory)
      .where(eq(workflowEditHistory.workflowId, id))
      .orderBy(asc(workflowEditHistory.createdAt));
    if (rows.length > 100) {
      const old = rows.slice(0, rows.length - 100).map((r) => r.id);
      await db.delete(workflowEditHistory).where(inArray(workflowEditHistory.id, old));
    }
    return { index: rows.length - 1 };
  });

  app.post("/workflows/:id/history/move", async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { currentIndex: number; delta: number };
    const rows = await db
      .select({ id: workflowEditHistory.id, snapshot: workflowEditHistory.snapshot, createdAt: workflowEditHistory.createdAt })
      .from(workflowEditHistory)
      .where(eq(workflowEditHistory.workflowId, id))
      .orderBy(asc(workflowEditHistory.createdAt));
    if (rows.length === 0) return reply.code(404).send({ error: "Sin historial" });
    const idx = Math.max(0, Math.min(rows.length - 1, (b.currentIndex ?? rows.length - 1) + b.delta));
    const entry = rows[idx]!;
    return { snapshot: entry.snapshot, index: idx };
  });

  app.get("/workflows/:id/versions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [wf] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.ownerId, request.user.sub)))
      .limit(1);
    if (!wf) return reply.code(404).send({ error: "Flujo no encontrado" });
    return db.select().from(workflowVersions).where(eq(workflowVersions.workflowId, id)).orderBy(desc(workflowVersions.version));
  });

  app.post("/workflows/:id/restore/:version", async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string };
    const [wf] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.ownerId, request.user.sub)))
      .limit(1);
    if (!wf) return reply.code(404).send({ error: "Flujo no encontrado" });
    const [snapshot] = await db
      .select()
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowId, id), eq(workflowVersions.version, Number(version))))
      .limit(1);
    if (!snapshot) return reply.code(404).send({ error: "Versión no encontrada" });
    const graph = snapshot.graph as { nodes: never[]; edges: never[] };
    await persistGraph(id, graph.nodes ?? [], graph.edges ?? []);
    const newVersion = wf.version + 1;
    await db.update(workflows).set({ version: newVersion, updatedAt: new Date() }).where(eq(workflows.id, id));
    return { ok: true, version: newVersion };
  });
}

async function persistGraph(
  workflowId: string,
  nodes: { key: string; type: string; name: string; description?: string; modelId?: string; subagentId?: string; expectedResult?: string; harness?: unknown; workingDir?: string; joinPolicy?: string; loopGuard?: unknown; position?: unknown; usesWorkflowId?: string }[],
  edges: { fromNodeKey: string; toNodeKey: string; condition?: unknown }[],
): Promise<void> {
  await db.delete(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
  await db.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));
  if (nodes.length > 0) {
    await db.insert(workflowNodes).values(
      nodes.map((n) => ({
        workflowId,
        key: n.key,
        type: n.type as never,
        name: n.name,
        description: n.description,
        modelId: n.modelId,
        subagentId: n.subagentId,
        expectedResult: n.expectedResult,
        harness: (n.harness ?? {}) as never,
        workingDir: n.workingDir ?? ".",
        joinPolicy: (n.joinPolicy ?? "all") as never,
        loopGuard: n.loopGuard as never,
        usesWorkflowId: n.usesWorkflowId,
        position: n.position as never,
      })),
    );
  }
  if (edges.length > 0) {
    await db.insert(workflowEdges).values(
      edges.map((e) => ({ workflowId, fromNodeKey: e.fromNodeKey, toNodeKey: e.toNodeKey, condition: e.condition as never })),
    );
  }
}
