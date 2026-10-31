import {
  assistantMessages,
  assistantProposals,
  contracts,
  db,
  documentChunks,
  documents,
  longTermMemory,
  models,
  projectBudgets,
  projectContainers,
  projectFeatures,
  projects,
  providers,
  runEvents,
  runSummaries,
  stepRuns,
  usageRecords,
  workflowRuns,
} from "@factoria/db";
import {
  chat,
  chatJson,
  containerHostPort,
  containerLogs,
  containerName,
  defaultProjectImage,
  dockerAvailable,
  embedTexts,
  ensureContainer,
  execContainer,
  fitDimensions,
  inspectContainer,
  lsRemote,
  removeContainer,
  rerank,
  stopContainer,
  type GitAuth,
  type ProviderEndpoint,
} from "@factoria/core";
import { createProjectSchema } from "@factoria/shared";
import type { RepoProvider } from "@factoria/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { decryptSecret, encryptSecret } from "../lib/crypto.ts";

/** Oculta el token de repositorio y expone sólo su presencia. */
function sanitizeProject<T extends { repoTokenEncrypted?: string | null }>(row: T): Omit<T, "repoTokenEncrypted"> & { hasRepoToken: boolean } {
  const { repoTokenEncrypted, ...rest } = row;
  return { ...rest, hasRepoToken: Boolean(repoTokenEncrypted) };
}

async function ownedProject(request: FastifyRequest, id: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, request.user.sub)))
    .limit(1);
  return row;
}

async function modelEndpoint(
  ownerId: string,
  modelId: string,
): Promise<{ provider: ProviderEndpoint; modelId: string } | null> {
  const [row] = await db
    .select({
      baseUrl: providers.baseUrl,
      apiKeyEncrypted: providers.apiKeyEncrypted,
      modelId: models.modelId,
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(and(eq(models.id, modelId), eq(providers.ownerId, ownerId)))
    .limit(1);
  if (!row) return null;
  return {
    provider: { baseUrl: row.baseUrl ?? "https://api.openai.com/v1", apiKey: decryptSecret(row.apiKeyEncrypted) },
    modelId: row.modelId,
  };
}

function chunkText(text: string, size = 900, overlap = 120): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size));
    i += size - overlap;
  }
  return chunks;
}

function projectContextText(p: {
  name: string;
  objective: string;
  description?: string | null;
  stack: string[];
}): string {
  return `Proyecto: ${p.name}\nObjetivo: ${p.objective}\n${p.description ? `Descripción: ${p.description}\n` : ""}Stack: ${p.stack.join(", ")}`;
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/projects", async (request) => {
    const rows = await db.select().from(projects).where(eq(projects.ownerId, request.user.sub)).orderBy(desc(projects.createdAt));
    return rows.map(sanitizeProject);
  });

  app.get("/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await ownedProject(request, id);
    if (!row) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const [features, projectContracts, projectDocuments] = await Promise.all([
      db.select().from(projectFeatures).where(eq(projectFeatures.projectId, id)).orderBy(asc(projectFeatures.priority)),
      db.select().from(contracts).where(eq(contracts.projectId, id)).orderBy(asc(contracts.order)),
      db.select().from(documents).where(eq(documents.projectId, id)).orderBy(desc(documents.createdAt)),
    ]);
    return { ...sanitizeProject(row), features, contracts: projectContracts, documents: projectDocuments };
  });

  app.post("/projects", async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    const data = parsed.data;
    const workspaceRoot =
      data.workspaceRoot ?? `${process.env.WORKSPACES_ROOT ?? "/workspaces"}/${request.user.sub}/${Date.now()}`;
    const [row] = await db
      .insert(projects)
      .values({
        ownerId: request.user.sub,
        name: data.name,
        programName: data.programName,
        objective: data.objective,
        description: data.description,
        stack: data.stack,
        workspaceRoot,
        workflowId: data.workflowId,
        embeddingModelId: data.embeddingModelId,
        rerankModelId: data.rerankModelId,
        assistantModelId: data.assistantModelId,
        assistantInstructions: data.assistantInstructions,
        defaultHarness: data.defaultHarness as Record<string, unknown> | undefined,
        repoUrl: data.repoUrl,
        repoBranch: data.repoBranch,
        repoProvider: data.repoProvider,
        repoTokenEncrypted: data.repoToken ? encryptSecret(data.repoToken) : undefined,
        containerImage: data.containerImage,
        containerEnabled: data.containerEnabled,
        containerNetworkMode: data.containerNetworkMode,
        stateBackend: data.stateBackend,
        boardName: data.boardName,
      })
      .returning();
    return reply.code(201).send(sanitizeProject(row!));
  });

  app.patch("/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await ownedProject(request, id);
    if (!row) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const body = request.body as Record<string, unknown>;
    const allowed = [
      "name", "programName", "objective", "description", "stack", "workflowId",
      "embeddingModelId", "rerankModelId", "assistantModelId", "assistantInstructions",
      "defaultHarness", "status", "repoUrl", "repoBranch", "repoProvider", "repoUsername",
      "containerImage", "containerEnabled", "containerNetworkMode", "devCommand", "devPort", "stateBackend", "boardName",
    ];
    const values: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) if (body[key] !== undefined) values[key] = body[key];
    if (typeof body.repoToken === "string") {
      values.repoTokenEncrypted = body.repoToken ? encryptSecret(body.repoToken) : null;
    }
    const [updated] = await db.update(projects).set(values).where(eq(projects.id, id)).returning();
    return sanitizeProject(updated!);
  });

  app.delete("/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerId, request.user.sub)));
    return reply.code(204).send();
  });

  // --- Funcionalidades ---
  app.post("/projects/:id/features", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const b = request.body as { title: string; description?: string; priority?: number };
    const [row] = await db
      .insert(projectFeatures)
      .values({ projectId: id, title: b.title, description: b.description, priority: b.priority ?? 0 })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete("/projects/:id/features/:featureId", async (request, reply) => {
    const { id, featureId } = request.params as { id: string; featureId: string };
    await db.delete(projectFeatures).where(and(eq(projectFeatures.id, featureId), eq(projectFeatures.projectId, id)));
    return reply.code(204).send();
  });

  // --- Contratos ---
  app.post("/projects/:id/contracts", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const b = request.body as { title: string; criterion: string; verification?: string; order?: number };
    const [row] = await db
      .insert(contracts)
      .values({ projectId: id, title: b.title, criterion: b.criterion, verification: (b.verification ?? "llm") as never, order: b.order ?? 0 })
      .returning();
    return reply.code(201).send(row);
  });

  app.patch("/projects/:id/contracts/:contractId", async (request, reply) => {
    const { id, contractId } = request.params as { id: string; contractId: string };
    const b = request.body as { status?: string };
    const [row] = await db
      .update(contracts)
      .set({ status: (b.status ?? "pending") as never })
      .where(and(eq(contracts.id, contractId), eq(contracts.projectId, id)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Contrato no encontrado" });
    return row;
  });

  app.delete("/projects/:id/contracts/:contractId", async (request, reply) => {
    const { id, contractId } = request.params as { id: string; contractId: string };
    await db.delete(contracts).where(and(eq(contracts.id, contractId), eq(contracts.projectId, id)));
    return reply.code(204).send();
  });

  // --- Documentos ---
  app.post("/projects/:id/documents", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const b = request.body as { type?: string; title: string; mimeType?: string; text?: string };
    const [row] = await db
      .insert(documents)
      .values({
        projectId: id,
        type: (b.type ?? "reference") as never,
        title: b.title,
        mimeType: b.mimeType,
        textExtracted: b.text,
        source: "uploaded",
        indexedStatus: "pending",
      })
      .returning();
    if (row && b.text) await indexDocument(request.user.sub, project, row.id, row.textExtracted ?? "");
    return reply.code(201).send(row);
  });

  app.post("/projects/:id/documents/:docId/index", async (request, reply) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const [doc] = await db.select().from(documents).where(and(eq(documents.id, docId), eq(documents.projectId, id))).limit(1);
    if (!doc) return reply.code(404).send({ error: "Documento no encontrado" });
    const result = await indexDocument(request.user.sub, project, doc.id, doc.textExtracted ?? "");
    return result;
  });

  app.post("/projects/:id/index", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const docs = await db.select().from(documents).where(eq(documents.projectId, id));
    let indexed = 0;
    for (const d of docs) {
      if (!d.textExtracted) continue;
      const r = await indexDocument(request.user.sub, project, d.id, d.textExtracted);
      if (r.indexed) indexed += 1;
    }
    return { documents: docs.length, indexed };
  });

  app.delete("/projects/:id/documents/:docId", async (request, reply) => {
    const { id, docId } = request.params as { id: string; docId: string };
    await db.delete(documents).where(and(eq(documents.id, docId), eq(documents.projectId, id)));
    return reply.code(204).send();
  });

  // Subida de ficheros (PDF, XML, TXT, MD, JSON, CSV, HTML…) al RAG.
  app.post(
    "/projects/:id/documents/upload",
    { config: { bodyLimit: 25 * 1024 * 1024 } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const project = await ownedProject(request, id);
      if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
      const b = request.body as { title?: string; filename?: string; mimeType?: string; dataBase64: string };
      if (!b?.dataBase64) return reply.code(400).send({ error: "Falta dataBase64" });

      let buf: Buffer;
      try {
        buf = Buffer.from(b.dataBase64, "base64");
      } catch {
        return reply.code(400).send({ error: "dataBase64 no es base64 válido" });
      }
      const filename = b.filename ?? "documento";
      const ext = filename.toLowerCase().split(".").pop() ?? "";
      const title = b.title?.trim() || filename;

      let text = "";
      try {
        if (ext === "pdf" || b.mimeType === "application/pdf") {
          text = await extractPdf(buf);
        } else if (["xml", "html", "htm", "svg"].includes(ext)) {
          text = stripTags(buf.toString("utf8"));
        } else {
          text = buf.toString("utf8");
        }
      } catch (error) {
        request.log.warn({ err: error instanceof Error ? error.message : error }, "extracción de texto falló");
      }
      if (!text.trim()) {
        return reply.code(422).send({ error: "No se pudo extraer texto del documento" });
      }

      const [row] = await db
        .insert(documents)
        .values({
          projectId: id,
          type: "reference",
          title,
          mimeType: b.mimeType ?? `application/${ext}`,
          storagePath: filename,
          textExtracted: text,
          source: "uploaded",
          indexedStatus: "pending",
        })
        .returning();
      const result = await indexDocument(request.user.sub, project, row!.id, text);
      const [fresh] = await db.select().from(documents).where(eq(documents.id, row!.id)).limit(1);
      return reply.code(201).send({ document: fresh, chunks: result.chunks });
    },
  );

  app.post("/projects/:id/generate-image", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const b = request.body as { prompt: string; modelId?: string; size?: string };

    const rows = await db
      .select({ id: models.id, modelId: models.modelId, displayName: models.displayName, providerId: models.providerId, capabilities: models.capabilities })
      .from(models)
      .innerJoin(providers, eq(models.providerId, providers.id))
      .where(eq(providers.ownerId, request.user.sub));
    const chosen = b.modelId ? rows.find((r) => r.id === b.modelId) : rows.find((r) => r.capabilities.includes("imageGeneration"));

    let storagePath: string | undefined;
    let mimeType = "image/png";
    let usedModel: string | undefined;

    if (chosen) {
      const ep = await modelEndpoint(request.user.sub, chosen.id);
      if (ep) {
        const rawName = ep.modelId.includes("/") ? ep.modelId.slice(ep.modelId.indexOf("/") + 1) : ep.modelId;
        const baseUrl = ep.provider.baseUrl.replace(/\/$/, "");
        try {
          const resp = await fetch(`${baseUrl}/images/generations`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${ep.provider.apiKey}` },
            body: JSON.stringify({ model: rawName, prompt: b.prompt, n: 1, size: b.size ?? "1024x1024" }),
            signal: AbortSignal.timeout(120000),
          });
          if (resp.ok) {
            const json = (await resp.json()) as { data?: { url?: string; b64_json?: string }[] };
            const item = json.data?.[0];
            if (item?.url) {
              storagePath = item.url;
              mimeType = item.url.endsWith(".jpg") || item.url.endsWith(".jpeg") ? "image/jpeg" : "image/png";
              usedModel = chosen.displayName;
            } else if (item?.b64_json) {
              storagePath = `data:image/png;base64,${item.b64_json}`;
              usedModel = chosen.displayName;
            }
          } else {
            request.log.warn({ status: resp.status, model: rawName }, "generación de imagen falló en el proveedor");
          }
        } catch (error) {
          request.log.warn({ err: error instanceof Error ? error.message : error }, "error llamando al proveedor de imágenes");
        }
      }
    }

    if (!storagePath) {
      usedModel = usedModel ?? "marcador";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%234f8cff"/><stop offset="1" stop-color="%23131a26"/></linearGradient></defs><rect width="640" height="400" fill="url(%23g)"/><text x="24" y="200" fill="white" font-family="sans-serif" font-size="20">Boceto (sin modelo)</text><foreignObject x="24" y="220" width="592" height="160"><div xmlns="http://www.w3.org/1999/xhtml" style="color:white;font-family:sans-serif;font-size:14px">${escapeHtml(b.prompt).slice(0, 200)}</div></foreignObject></svg>`;
      storagePath = `data:image/svg+xml;utf8,${svg}`;
      mimeType = "image/svg+xml";
    }

    const [row] = await db
      .insert(documents)
      .values({
        projectId: id,
        type: "image",
        title: `${usedModel ?? "Imagen"}: ${b.prompt.slice(0, 60)}`,
        mimeType,
        storagePath,
        source: "generated",
        indexedStatus: "indexed",
      })
      .returning();
    if (chosen && usedModel) {
      await db.insert(usageRecords).values({ projectId: id, modelId: chosen.id, providerId: chosen.providerId, kind: "image", cost: "0" });
    }
    return reply.code(201).send(row);
  });

  // --- Búsqueda semántica (RAG) con rerank y respaldo léxico ---
  app.get("/projects/:id/search", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const q = ((request.query as { q?: string }).q ?? "").trim();
    const topK = Number((request.query as { topK?: string }).topK ?? 5);

    if (project.embeddingModelId && q) {
      const ep = await modelEndpoint(request.user.sub, project.embeddingModelId);
      if (ep) {
        try {
          const [qv] = await embedTexts(ep.provider, ep.modelId, [q]);
          const vec = fitDimensions(qv ?? []);
          const rows = await db
            .select({ content: documentChunks.content, title: documents.title, type: documents.type, distance: sql<number>`${documentChunks.embedding} <=> ${sql.raw(`'[${vec.join(",")}]'::vector`)}` })
            .from(documentChunks)
            .innerJoin(documents, eq(documentChunks.documentId, documents.id))
            .where(eq(documentChunks.projectId, id))
            .orderBy(sql`${documentChunks.embedding} <=> ${sql.raw(`'[${vec.join(",")}]'::vector`)}`)
            .limit(Math.max(topK * 3, topK));
          let results = rows.map((r) => ({ title: r.title, type: r.type, score: Number(r.distance), snippet: r.content.slice(0, 400) }));
          if (project.rerankModelId && results.length > 1) {
            const rp = await modelEndpoint(request.user.sub, project.rerankModelId);
            if (rp) {
              const ranked = await rerank(rp.provider, rp.modelId, q, results.map((r) => `${r.title}\n${r.snippet}`));
              results = ranked.map((rr, i) => ({ ...results[rr.index]!, score: rr.score, rank: i + 1 })).filter(Boolean);
              await db.insert(usageRecords).values({ projectId: id, modelId: project.rerankModelId, kind: "rerank", inputTokens: Math.ceil(q.length / 4), cost: "0" });
            }
          }
          return { query: q, mode: "semantic", results: results.slice(0, topK) };
        } catch (error) {
          request.log.warn({ err: error instanceof Error ? error.message : error }, "búsqueda semántica falló, usando léxica");
        }
      }
    }

    const docs = await db.select().from(documents).where(eq(documents.projectId, id));
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = docs
      .filter((d) => d.textExtracted)
      .map((d) => {
        const haystack = `${d.title} ${d.textExtracted}`.toLowerCase();
        const score = terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
        return { title: d.title, type: d.type, score, snippet: d.textExtracted?.slice(0, 400) };
      })
      .filter((r) => (terms.length === 0 ? true : r.score > 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return { query: q, mode: "lexical", results: scored };
  });

  // --- Memoria de largo plazo (con embedding) ---
  app.post("/projects/:id/memory", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const b = request.body as { content: string; scope?: string };
    let embedding: number[] | undefined;
    if (project.embeddingModelId) {
      const ep = await modelEndpoint(request.user.sub, project.embeddingModelId);
      if (ep) {
        try {
          const [v] = await embedTexts(ep.provider, ep.modelId, [b.content]);
          if (v) embedding = fitDimensions(v);
        } catch { /* sin embedding */ }
      }
    }
    const [row] = await db
      .insert(longTermMemory)
      .values({ scope: (b.scope ?? "project") as never, projectId: id, content: b.content, embedding })
      .returning();
    return reply.code(201).send(row);
  });

  app.get("/projects/:id/memory", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const q = ((request.query as { q?: string }).q ?? "").trim();
    if (q && project.embeddingModelId) {
      const ep = await modelEndpoint(request.user.sub, project.embeddingModelId);
      if (ep) {
        try {
          const [v] = await embedTexts(ep.provider, ep.modelId, [q]);
          if (v) {
            const vec = fitDimensions(v);
            return db
              .select({ id: longTermMemory.id, content: longTermMemory.content, scope: longTermMemory.scope })
              .from(longTermMemory)
              .where(eq(longTermMemory.projectId, id))
              .orderBy(sql`${longTermMemory.embedding} <=> ${sql.raw(`'[${vec.join(",")}]'::vector`)}`)
              .limit(8);
          }
        } catch { /* fallback */ }
      }
    }
    const rows = await db.select().from(longTermMemory).where(eq(longTermMemory.projectId, id));
    return q ? rows.filter((r) => r.content.toLowerCase().includes(q.toLowerCase())) : rows;
  });

  // --- Presupuesto y uso ---
  app.get("/projects/:id/budget", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const [row] = await db.select().from(projectBudgets).where(eq(projectBudgets.projectId, id)).limit(1);
    return row ?? { projectId: id, limitUsd: null, softLimitUsd: null, period: "monthly" };
  });

  app.put("/projects/:id/budget", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const b = request.body as { limitUsd?: number; softLimitUsd?: number; webhookUrl?: string };
    const [existing] = await db.select().from(projectBudgets).where(eq(projectBudgets.projectId, id)).limit(1);
    const values = {
      limitUsd: b.limitUsd?.toString(),
      softLimitUsd: b.softLimitUsd?.toString(),
      webhookUrl: b.webhookUrl ?? null,
    };
    if (existing) {
      const [row] = await db.update(projectBudgets).set(values).where(eq(projectBudgets.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(projectBudgets).values({ projectId: id, ...values }).returning();
    return reply.code(201).send(row);
  });

  app.get("/projects/:id/usage", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const rows = await db
      .select({
        modelId: usageRecords.modelId,
        kind: usageRecords.kind,
        inputTokens: usageRecords.inputTokens,
        outputTokens: usageRecords.outputTokens,
        cost: usageRecords.cost,
      })
      .from(usageRecords)
      .where(eq(usageRecords.projectId, id));
    const totals = rows.reduce(
      (acc, r) => {
        acc.inputTokens += r.inputTokens;
        acc.outputTokens += r.outputTokens;
        acc.cost += Number(r.cost);
        return acc;
      },
      { inputTokens: 0, outputTokens: 0, cost: 0 },
    );
    return { totals, records: rows.length };
  });

  app.get("/projects/:id/usage/by-model", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const rows = await db
      .select({
        modelId: usageRecords.modelId,
        kind: usageRecords.kind,
        inputTokens: sql<string>`sum(${usageRecords.inputTokens})`,
        outputTokens: sql<string>`sum(${usageRecords.outputTokens})`,
        cost: sql<string>`sum(${usageRecords.cost})`,
        count: sql<string>`count(*)`,
      })
      .from(usageRecords)
      .where(eq(usageRecords.projectId, id))
      .groupBy(usageRecords.modelId, usageRecords.kind);
    const total = rows.reduce((acc, r) => acc + Number(r.cost), 0);
    return {
      rows: rows.map((r) => ({ ...r, cost: Number(r.cost), inputTokens: Number(r.inputTokens), outputTokens: Number(r.outputTokens), count: Number(r.count), pct: total > 0 ? Number(r.cost) / total : 0 })),
      totalCost: total,
    };
  });

  app.get("/projects/:id/usage/daily", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const days = Math.min(Number((request.query as { days?: string }).days ?? 30), 90);
    const rows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${usageRecords.createdAt}), 'YYYY-MM-DD')`,
        cost: sql<string>`sum(${usageRecords.cost})`,
        tokens: sql<string>`sum(${usageRecords.inputTokens} + ${usageRecords.outputTokens})`,
      })
      .from(usageRecords)
      .where(eq(usageRecords.projectId, id))
      .groupBy(sql`date_trunc('day', ${usageRecords.createdAt})`)
      .orderBy(sql`date_trunc('day', ${usageRecords.createdAt})`);
    return { days, rows: rows.map((r) => ({ day: r.day, cost: Number(r.cost), tokens: Number(r.tokens) })) };
  });

  app.post("/projects/:id/budget/test-webhook", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [budget] = await db.select().from(projectBudgets).where(eq(projectBudgets.projectId, id)).limit(1);
    if (!budget?.webhookUrl) return reply.code(400).send({ error: "Sin webhook configurado" });
    const ok = await postWebhook(budget.webhookUrl, { type: "test", projectId: id, message: "Prueba de alerta de presupuesto de Factoría de Agentes" });
    return { ok };
  });

  // --- Asistente ---
  app.get("/projects/:id/assistant/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    return db.select().from(assistantMessages).where(eq(assistantMessages.projectId, id)).orderBy(asc(assistantMessages.createdAt));
  });

  app.post("/projects/:id/assistant/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const b = request.body as { content: string };
    await db.insert(assistantMessages).values({ projectId: id, role: "user", content: b.content });

    const lower = b.content.toLowerCase();
    const ep = project.assistantModelId ? await modelEndpoint(request.user.sub, project.assistantModelId) : null;
    let replyText = "";
    let proposal: typeof assistantProposals.$inferSelect | undefined;

    const wantsFeatures = /funcional|feature|característica|caracteristica/.test(lower);
    const wantsContracts = /contrato|criterio|aceptaci/.test(lower);

    if (wantsFeatures) {
      const items = ep && project.assistantModelId
        ? await proposeFeatures(ep, project)
        : suggestFeatures(project.programName, project.objective, project.description ?? "");
      proposal = await upsertProposal(id, "features", { features: items });
      replyText = `He propuesto ${items.length} funcionalidades. Revísalas y acéptalas si te encajan.`;
    } else if (wantsContracts) {
      const list = ep && project.assistantModelId
        ? await proposeContracts(ep, project)
        : [
            { title: "Compila sin errores", criterion: "El proyecto compila y pasa el typecheck", verification: "command" },
            { title: "Pruebas en verde", criterion: "La suite de tests pasa", verification: "command" },
          ];
      proposal = await upsertProposal(id, "contracts", { contracts: list });
      replyText = `He propuesto ${list.length} contratos de aceptación. Acéptalos para añadirlos al proyecto.`;
    } else if (ep) {
      const [features, projectContracts, docs, mem, runs] = await Promise.all([
        db.select().from(projectFeatures).where(eq(projectFeatures.projectId, id)),
        db.select().from(contracts).where(eq(contracts.projectId, id)),
        db.select().from(documents).where(eq(documents.projectId, id)),
        db.select().from(longTermMemory).where(eq(longTermMemory.projectId, id)),
        db.select().from(workflowRuns).where(eq(workflowRuns.projectId, id)),
      ]);
      const ctx = [
        projectContextText(project),
        `Funcionalidades: ${features.map((f) => f.title).join(", ") || "ninguna"}`,
        `Contratos: ${projectContracts.map((c) => c.title).join(", ") || "ninguno"}`,
        `Documentos: ${docs.map((d) => d.title).join(", ") || "ninguno"}`,
        `Memoria: ${mem.map((m) => m.content).slice(-5).join(" | ") || "vacía"}`,
        await runLogContext(id),
      ].join("\n");
      try {
        replyText = await chat({
          provider: ep.provider,
          modelId: ep.modelId,
          system: `${project.assistantInstructions ?? "Eres el asistente del proyecto."} Ayudas al usuario, das la visión general y propones mejoras. Responde en español, breve y concreto. Tienes acceso al estado de las ejecuciones y a los eventos recientes (log) incluidos en el contexto: cuando te pregunten por un fallo, cita el paso, el motivo exacto y la hora; no inventes datos que no aparezcan en el contexto.`,
          prompt: `Contexto del proyecto:\n${ctx}\n\nPregunta del usuario: ${b.content}`,
        });
      } catch {
        replyText = fallbackReply(project, runs.length, await runLogContext(id));
      }
    } else {
      const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.projectId, id));
      replyText = fallbackReply(project, runs.length, await runLogContext(id));
    }

    const [assistantRow] = await db
      .insert(assistantMessages)
      .values({ projectId: id, role: "assistant", content: replyText })
      .returning();
    return reply.code(201).send({ message: assistantRow, proposal });
  });

  app.get("/projects/:id/assistant/proposals", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    return db
      .select()
      .from(assistantProposals)
      .where(and(eq(assistantProposals.projectId, id), eq(assistantProposals.status, "pending")))
      .orderBy(desc(assistantProposals.createdAt));
  });

  app.post("/projects/:id/assistant/proposals/:proposalId/:decision", async (request, reply) => {
    const { id, proposalId, decision } = request.params as { id: string; proposalId: string; decision: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const [proposal] = await db
      .select()
      .from(assistantProposals)
      .where(and(eq(assistantProposals.id, proposalId), eq(assistantProposals.projectId, id)))
      .limit(1);
    if (!proposal) return reply.code(404).send({ error: "Propuesta no encontrada" });
    // Idempotencia: sólo se aplica la primera vez.
    if (proposal.status !== "pending") return { ok: true, alreadyDecided: true };

    if (decision === "accept") {
      if (proposal.kind === "features") {
        const features = (proposal.payload as { features?: string[] }).features ?? [];
        if (features.length > 0) {
          await db.insert(projectFeatures).values(features.map((title, i) => ({ projectId: id, title, priority: i })));
        }
      } else if (proposal.kind === "contracts") {
        const list = (proposal.payload as { contracts?: { title: string; criterion: string; verification: string }[] }).contracts ?? [];
        if (list.length > 0) {
          await db.insert(contracts).values(
            list.map((c, i) => ({ projectId: id, title: c.title, criterion: c.criterion, verification: c.verification as never, order: i })),
          );
        }
      }
    }
    await db
      .update(assistantProposals)
      .set({ status: decision === "accept" ? "accepted" : "rejected", decidedAt: new Date() })
      .where(eq(assistantProposals.id, proposalId));
    return { ok: true };
  });

  app.post("/projects/:id/assistant/summarize", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const sinceSeq = Number((request.query as { sinceSeq?: string }).sinceSeq ?? 0);
    const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.projectId, id)).orderBy(desc(workflowRuns.createdAt));
    let total = 0;
    let maxSeq = sinceSeq;
    const notable: string[] = [];
    for (const run of runs) {
      const events = await db.select().from(runEvents).where(eq(runEvents.runId, run.id)).orderBy(asc(runEvents.seq));
      for (const e of events) {
        if (e.seq <= sinceSeq) continue;
        total += 1;
        maxSeq = Math.max(maxSeq, e.seq);
        if (e.level !== "info" || /finalizado|completado|fallido|aprob/i.test(e.message)) notable.push(e.message);
      }
    }
    let summary =
      total === 0
        ? "No ha habido actividad nueva desde tu última conexión."
        : `Mientras estabas ausente se registraron ${total} eventos. Destacados: ${notable.slice(-6).join(" · ") || "sin incidencias relevantes"}.`;

    const ep = project.assistantModelId ? await modelEndpoint(request.user.sub, project.assistantModelId) : null;
    if (ep && total > 0) {
      try {
        summary = await chat({
          provider: ep.provider,
          modelId: ep.modelId,
          system: "Resume de forma breve y clara lo ocurrido en el proyecto durante la ausencia del usuario.",
          prompt: `Proyecto: ${project.name}\nEventos destacados:\n- ${notable.slice(-20).join("\n- ") || "sin destacados"}\nTotal de eventos: ${total}`,
        });
      } catch { /* usa el resumen determinista */ }
    }

    if (runs[0]) {
      await db.insert(runSummaries).values({ runId: runs[0].id, projectId: id, fromSeq: sinceSeq, toSeq: maxSeq, summary, modelId: project.assistantModelId ?? undefined });
    }
    const [row] = await db.insert(assistantMessages).values({ projectId: id, role: "assistant", content: summary }).returning();
    return reply.send({ summary, message: row });
  });

  // --- Project Info: contexto para agentes/subagentes ---
  app.get("/projects/:id/context", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const [features, projectContracts, projectDocuments, memory] = await Promise.all([
      db.select().from(projectFeatures).where(eq(projectFeatures.projectId, id)),
      db.select().from(contracts).where(eq(contracts.projectId, id)),
      db.select().from(documents).where(eq(documents.projectId, id)),
      db.select().from(longTermMemory).where(eq(longTermMemory.projectId, id)),
    ]);
    return {
      project: { name: project.name, programName: project.programName, objective: project.objective, stack: project.stack, status: project.status },
      features: features.map((f) => ({ title: f.title, description: f.description, status: f.status })),
      contracts: projectContracts.map((c) => ({ title: c.title, criterion: c.criterion, status: c.status })),
      documents: projectDocuments.map((d) => ({ title: d.title, type: d.type, text: d.textExtracted?.slice(0, 2000) })),
      memory: memory.map((m) => m.content),
    };
  });

  // --- Repositorio: comprobación de acceso con el token del proyecto ---
  app.post("/projects/:id/repo/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const b = request.body as { repoUrl?: string; repoToken?: string; repoProvider?: string };
    const url = b.repoUrl ?? project.repoUrl;
    if (!url) return reply.code(400).send({ error: "El proyecto no tiene repositorio configurado" });
    let token = b.repoToken;
    if (token === undefined && project.repoTokenEncrypted) {
      try {
        token = decryptSecret(project.repoTokenEncrypted);
      } catch {
        token = undefined;
      }
    }
    const provider = (b.repoProvider ?? project.repoProvider ?? "other") as RepoProvider;
    const auth: GitAuth | undefined = token ? { provider, token } : undefined;
    const result = lsRemote(url, auth);
    const branches = result.output
      .split("\n")
      .map((l) => l.split("refs/heads/")[1]?.trim())
      .filter(Boolean);
    return { ok: result.ok, branches, message: result.ok ? "Acceso correcto" : result.output.slice(0, 300) };
  });

  // --- Contenedor de desarrollo del proyecto ---
  app.get("/projects/:id/container/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const [row] = await db.select().from(projectContainers).where(eq(projectContainers.projectId, id)).limit(1);
    if (!row) return { status: "stopped", available: await dockerAvailable() };
    const info = await inspectContainer(row.name ?? containerName(id));
    const running = Boolean(info?.State?.Running);
    return { ...row, status: running ? "running" : row.status, available: await dockerAvailable() };
  });

  app.post("/projects/:id/container/up", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    if (!(await dockerAvailable())) return reply.code(503).send({ error: "El motor de contenedores no está disponible" });
    const spec = {
      projectId: id,
      image: project.containerImage ?? defaultProjectImage(),
      workspacePath: project.workspaceRoot ?? `${process.env.WORKSPACES_ROOT ?? "/workspaces"}/${id}`,
      networkMode: project.containerNetworkMode,
      env: { FACTORIA_PROJECT_ID: id },
      ports: [project.devPort ?? 3000],
    };
    const result = await ensureContainer(spec);
    await db
      .insert(projectContainers)
      .values({
        projectId: id,
        name: result.name,
        status: result.running ? "running" : "error",
        containerId: result.id,
        image: spec.image,
        networkMode: project.containerNetworkMode,
        endpoint: result.running ? `http://${result.name}:4096` : undefined,
        lastError: result.error,
        lastStartedAt: result.running ? new Date() : undefined,
      })
      .onConflictDoUpdate({
        target: projectContainers.projectId,
        set: {
          status: result.running ? "running" : "error",
          containerId: result.id,
          endpoint: result.running ? `http://${result.name}:4096` : undefined,
          lastError: result.error ?? null,
        },
      });
    return reply.code(result.running ? 200 : 500).send(result);
  });

  app.post("/projects/:id/container/down", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    await stopContainer(containerName(id));
    await db
      .update(projectContainers)
      .set({ status: "stopped", lastStoppedAt: new Date() })
      .where(eq(projectContainers.projectId, id));
    return { ok: true, status: "stopped" };
  });

  app.post("/projects/:id/container/rebuild", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    if (!(await dockerAvailable())) return reply.code(503).send({ error: "El motor de contenedores no está disponible" });
    await removeContainer(containerName(id));
    const spec = {
      projectId: id,
      image: project.containerImage ?? defaultProjectImage(),
      workspacePath: project.workspaceRoot ?? `${process.env.WORKSPACES_ROOT ?? "/workspaces"}/${id}`,
      networkMode: project.containerNetworkMode,
      env: { FACTORIA_PROJECT_ID: id },
      ports: [project.devPort ?? 3000],
    };
    const result = await ensureContainer(spec);
    await db
      .insert(projectContainers)
      .values({
        projectId: id,
        name: result.name,
        status: result.running ? "running" : "error",
        containerId: result.id,
        image: spec.image,
        networkMode: project.containerNetworkMode,
        endpoint: result.running ? `http://${result.name}:4096` : undefined,
        lastError: result.error,
      })
      .onConflictDoUpdate({
        target: projectContainers.projectId,
        set: { status: result.running ? "running" : "error", containerId: result.id, lastError: result.error ?? null },
      });
    return reply.code(result.running ? 200 : 500).send(result);
  });

  app.get("/projects/:id/container/logs", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const [row] = await db.select().from(projectContainers).where(eq(projectContainers.projectId, id)).limit(1);
    const logs = await containerLogs(row?.name ?? containerName(id), 200);
    return { logs };
  });

  // --- App del proyecto (servidor de desarrollo) ---
  app.get("/projects/:id/app/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const port = project.devPort ?? 3000;
    const name = containerName(id);
    const info = await inspectContainer(name);
    const containerRunning = Boolean(info?.State?.Running);
    const hostPort = containerRunning ? await containerHostPort(name, port) : null;
    let running = false;
    if (containerRunning) {
      try {
        await fetch(`http://${name}:${port}/`, { signal: AbortSignal.timeout(1500) });
        running = true;
      } catch {
        running = false;
      }
    }
    return {
      running,
      container: containerRunning ? "running" : "stopped",
      port,
      hostPort,
      endpoint: hostPort ? `http://127.0.0.1:${hostPort}` : null,
      command: (project.devCommand ?? "").trim() || detectDevCommand(project, port),
    };
  });

  app.post("/projects/:id/app/start", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    if (!(await dockerAvailable())) return reply.code(503).send({ error: "El motor de contenedores no está disponible" });
    const port = project.devPort ?? 3000;
    const spec = {
      projectId: id,
      image: project.containerImage ?? defaultProjectImage(),
      workspacePath: project.workspaceRoot ?? `${process.env.WORKSPACES_ROOT ?? "/workspaces"}/${id}`,
      networkMode: project.containerNetworkMode,
      env: { FACTORIA_PROJECT_ID: id },
      ports: [port],
    };
    const container = await ensureContainer(spec);
    if (!container.running) return reply.code(500).send({ error: container.error ?? "El contenedor no arrancó" });
    const command = (project.devCommand ?? "").trim() || detectDevCommand(project, port);
    const script = [
      "mkdir -p .factoria",
      "if [ -f .factoria/app.pid ]; then kill -- -$(cat .factoria/app.pid) 2>/dev/null || true; fi",
      `PORT=${port} setsid sh -lc ${shellQuote(command)} > .factoria/app.log 2>&1 & echo $! > .factoria/app.pid`,
      "sleep 1",
    ].join("; ");
    // El workspace suele pertenecer a root dentro del contenedor rootless;
    // ejecutamos como root del contenedor para poder escribir logs y pid.
    const exec = await execContainer(container.name, ["sh", "-lc", script], { user: "0" });
    if (!exec.ok) return reply.code(500).send({ error: String(exec.body).slice(0, 300) });
    const hostPort = await containerHostPort(container.name, port);
    return { running: true, port, hostPort, endpoint: hostPort ? `http://127.0.0.1:${hostPort}` : null, command };
  });

  app.post("/projects/:id/app/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const exec = await execContainer(
      containerName(id),
      [
        "sh",
        "-lc",
        "if [ -f .factoria/app.pid ]; then kill -- -$(cat .factoria/app.pid) 2>/dev/null || true; rm -f .factoria/app.pid; fi",
      ],
      { user: "0" },
    );
    if (!exec.ok) return reply.code(500).send({ error: String(exec.body).slice(0, 300) });
    return { ok: true, running: false };
  });

  app.get("/projects/:id/app/logs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const root = project.workspaceRoot ?? `${process.env.WORKSPACES_ROOT ?? "/workspaces"}/${id}`;
    const file = path.join(root, ".factoria", "app.log");
    if (!existsSync(file)) return { logs: "" };
    try {
      const text = readFileSync(file, "utf8");
      return { logs: text.split("\n").slice(-200).join("\n") };
    } catch {
      return { logs: "" };
    }
  });
}

function projectWorkspace(project: { id: string; workspaceRoot: string | null }): string {
  return project.workspaceRoot ?? `${process.env.WORKSPACES_ROOT ?? "/workspaces"}/${project.id}`;
}

function detectDevCommand(project: { id: string; workspaceRoot: string | null }, port: number): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectWorkspace(project), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    if (scripts.dev) return `npm run dev -- --host 0.0.0.0 --port ${port}`;
    if (scripts.start) return "npm start";
  } catch {
    /* sin package.json */
  }
  return `python3 -m http.server ${port} --bind 0.0.0.0`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function indexDocument(
  ownerId: string,
  project: { id: string; embeddingModelId: string | null },
  documentId: string,
  text: string,
): Promise<{ indexed: boolean; chunks: number }> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return { indexed: false, chunks: 0 };
  let embeddings: (number[] | undefined)[] = chunks.map(() => undefined);
  if (project.embeddingModelId) {
    const ep = await modelEndpoint(ownerId, project.embeddingModelId);
    if (ep) {
      try {
        const vecs = await embedTexts(ep.provider, ep.modelId, chunks);
        embeddings = vecs.map((v) => fitDimensions(v));
        await db.insert(usageRecords).values({
          projectId: project.id,
          modelId: project.embeddingModelId,
          kind: "embedding",
          inputTokens: Math.ceil(chunks.join(" ").length / 4),
          cost: "0",
        });
      } catch { /* sin embeddings: se guardan los chunks igualmente */ }
    }
  }
  await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
  await db.insert(documentChunks).values(
    chunks.map((content, i) => ({ documentId, projectId: project.id, chunkIndex: i, content, embedding: embeddings[i] })),
  );
  await db.update(documents).set({ indexedStatus: "indexed" }).where(eq(documents.id, documentId));
  return { indexed: true, chunks: chunks.length };
}

async function upsertProposal(
  projectId: string,
  kind: "features" | "contracts",
  payload: Record<string, unknown>,
): Promise<typeof assistantProposals.$inferSelect> {
  const pending = await db
    .select()
    .from(assistantProposals)
    .where(and(eq(assistantProposals.projectId, projectId), eq(assistantProposals.kind, kind), eq(assistantProposals.status, "pending")));
  const existing = pending.find((p) => JSON.stringify(p.payload) === JSON.stringify(payload));
  if (existing) return existing;
  const [row] = await db.insert(assistantProposals).values({ projectId, kind, payload: payload as never }).returning();
  return row!;
}

async function proposeFeatures(
  ep: { provider: ProviderEndpoint; modelId: string },
  project: { name: string; objective: string; description: string | null },
): Promise<string[]> {
  try {
    const result = await chatJson<{ features: string[] }>({
      provider: ep.provider,
      modelId: ep.modelId,
      system: "Propones funcionalidades concretas para un proyecto. Devuelves JSON.",
      prompt: `${projectContextText({ ...project, stack: [] })}\n\nLista 5-8 funcionalidades. JSON: {"features": ["..."]}`,
      json: true,
      temperature: 0.3,
    });
    return Array.isArray(result.features) ? result.features.slice(0, 12) : [];
  } catch {
    return suggestFeatures(project.name, project.objective, project.description ?? "");
  }
}

async function proposeContracts(
  ep: { provider: ProviderEndpoint; modelId: string },
  project: { name: string; objective: string },
): Promise<{ title: string; criterion: string; verification: string }[]> {
  try {
    const result = await chatJson<{ contracts: { title: string; criterion: string; verification: string }[] }>({
      provider: ep.provider,
      modelId: ep.modelId,
      system: "Propones contratos de aceptación (criterios verificables) para un proyecto. Devuelves JSON.",
      prompt: `Proyecto: ${project.name}\nObjetivo: ${project.objective}\n\nPropón 3-5 contratos. JSON: {"contracts":[{"title":"","criterion":"","verification":"command|llm|manual"}]}`,
      json: true,
      temperature: 0.2,
    });
    return Array.isArray(result.contracts) ? result.contracts.slice(0, 8) : [];
  } catch {
    return [
      { title: "Compila sin errores", criterion: "El proyecto compila y pasa el typecheck", verification: "command" },
      { title: "Pruebas en verde", criterion: "La suite de tests pasa", verification: "command" },
    ];
  }
}

/**
 * Estado y log reciente de las ejecuciones del proyecto. Se inyecta en el
 * contexto del asistente para que pueda explicar fallos con datos reales.
 */
async function runLogContext(projectId: string): Promise<string> {
  const fmt = (value: Date | string | null) =>
    value
      ? new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "medium" })
      : "—";

  const runs = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.projectId, projectId))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(5);
  if (runs.length === 0) return "Ejecuciones: ninguna.";

  const lines = [`Ejecuciones (últimas ${runs.length}):`];
  for (const run of runs) {
    lines.push(`- ${fmt(run.createdAt)} → ${run.status}${run.finishedAt ? ` (fin ${fmt(run.finishedAt)})` : ""}`);
  }

  const latest = runs[0]!;
  const inspected = runs.slice(0, 3);
  const stepsByRun = await Promise.all(
    inspected.map((run) => db.select().from(stepRuns).where(eq(stepRuns.runId, run.id)).orderBy(asc(stepRuns.startedAt))),
  );
  const failures = inspected.flatMap((run, index) =>
    stepsByRun[index]!
      .filter((step) => step.status === "failed")
      .map((step) => ({ run, step })),
  );
  if (failures.length > 0) {
    lines.push("", "Pasos fallidos de las últimas ejecuciones:");
    for (const { run, step } of failures) {
      let reason = step.error ?? "";
      if (!reason) {
        const [lastError] = await db
          .select({ message: runEvents.message })
          .from(runEvents)
          .where(and(eq(runEvents.runId, run.id), eq(runEvents.level, "error")))
          .orderBy(desc(runEvents.seq))
          .limit(1);
        reason = lastError?.message ?? "sin detalle";
      }
      lines.push(`- ${fmt(run.createdAt)} (${run.status}) «${step.nodeKey}»: ${reason.slice(0, 600)}`);
    }
    if (failures.some(({ step }) => /fetch failed/i.test(step.error ?? ""))) {
      lines.push(
        "",
        "Nota de diagnóstico: «fetch failed» es un error de red del cliente HTTP. En turnos largos suele deberse a un timeout del cliente o a una petición bloqueada, no necesariamente a una caída del proveedor; confirma la causa con el log del worker antes de afirmarlo.",
      );
    }
  }

  // Secuencia de la ejecución más reciente que falló (o la última si no hubo fallos).
  const logRun = runs.find((run) => run.status === "failed") ?? latest;
  const events = await db.select().from(runEvents).where(eq(runEvents.runId, logRun.id)).orderBy(asc(runEvents.seq));
  const notable = events
    .filter((event) => {
      const kind = (event.payload as { kind?: string } | null)?.kind;
      if (event.level === "error" || event.level === "warn" || event.source === "orchestrator") return true;
      return kind === "text" && event.message.trim().length > 0;
    })
    .slice(-40);
  if (notable.length > 0) {
    lines.push("", `Secuencia de la última ejecución${logRun.status === "failed" ? " fallida" : ""} (${fmt(logRun.createdAt)}):`);
    for (const event of notable) {
      lines.push(`[${fmt(event.createdAt)}] ${event.level}/${event.source}: ${event.message.replace(/\s+/g, " ").slice(0, 320)}`);
    }
  }
  return lines.join("\n");
}

function fallbackReply(project: { name: string; status: string; objective: string; stack: string[] }, runs: number, runLog?: string): string {
  return `Proyecto «${project.name}» (${project.status}). Objetivo: ${project.objective}. Stack: ${project.stack.join(", ") || "sin definir"}. Ejecuciones: ${runs}.${runLog ? `\n\n${runLog}` : ""} Pídeme «propón funcionalidades» o «propón contratos» para completar la definición.`;
}

function suggestFeatures(programName: string, _objective: string, _description: string): string[] {
  const base = `${programName}`;
  return [
    `Gestión del dominio de ${base}`,
    `Interfaz de usuario para ${base}`,
    "API y contrato de datos",
    "Persistencia y consultas",
    "Autenticación y control de acceso",
    `Documentación y pruebas de ${base}`,
  ];
}

async function postWebhook(url: string, payload: unknown): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch {
    return false;
  }
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function extractPdf(buf: Buffer): Promise<string> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
    getDocument: (src: { data: Uint8Array; useSystemFonts?: boolean }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>;
      }>;
    };
  };
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 80); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => it.str ?? "").join(" "));
  }
  return pages.join("\n\n").replace(/[ \t]+/g, " ").trim();
}

function stripTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .trim();
}
