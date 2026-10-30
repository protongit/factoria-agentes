import { db, models, providers } from "@factoria/db";
import { createModelSchema, createProviderSchema } from "@factoria/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { decryptSecret, encryptSecret } from "../lib/crypto.ts";

const IMAGE_RE = /image|flux|dall|sd|stable|imagen|painting|draw|qwen-image/i;
const EMBED_RE = /embed/i;
const RERANK_RE = /rerank/i;
const VISION_RE = /vision|gemma|gemini|gpt-4o|gpt-5|claude|qwen|llava|pixtral|mimo/i;

function capabilitiesFor(modelName: string): string[] {
  const caps = new Set<string>();
  if (IMAGE_RE.test(modelName)) {
    caps.add("imageGeneration");
    caps.add("vision");
    return [...caps];
  }
  if (EMBED_RE.test(modelName)) return ["embeddings"];
  if (RERANK_RE.test(modelName)) return ["rerank"];
  caps.add("code");
  caps.add("reasoning");
  caps.add("toolUse");
  caps.add("structuredOutput");
  caps.add("longContext");
  if (VISION_RE.test(modelName)) caps.add("vision");
  return [...caps];
}

async function fetchProviderModels(provider: { baseUrl: string | null; apiKeyEncrypted: string }) {
  const base = (provider.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const key = decryptSecret(provider.apiKeyEncrypted);
  const resp = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`El proveedor respondió ${resp.status}`);
  const json = (await resp.json()) as { data?: { id: string }[]; models?: { id?: string; name?: string }[] };
  const list = json.data ?? json.models ?? [];
  return list.map((m) => (m.id ?? (m as { name?: string }).name ?? "").toString()).filter(Boolean);
}

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/providers", async (request) => {
    return db
      .select({ id: providers.id, name: providers.name, baseUrl: providers.baseUrl, createdAt: providers.createdAt })
      .from(providers)
      .where(eq(providers.ownerId, request.user.sub))
      .orderBy(desc(providers.createdAt));
  });

  app.post("/providers", async (request, reply) => {
    const parsed = createProviderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    const { name, baseUrl, apiKey } = parsed.data;
    const [row] = await db
      .insert(providers)
      .values({ ownerId: request.user.sub, name, baseUrl, apiKeyEncrypted: encryptSecret(apiKey) })
      .returning({ id: providers.id, name: providers.name, baseUrl: providers.baseUrl });
    return reply.code(201).send(row);
  });

  app.patch("/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; baseUrl?: string; apiKey?: string };
    const values: Record<string, unknown> = {};
    if (body.name) values.name = body.name;
    if (body.baseUrl !== undefined) values.baseUrl = body.baseUrl;
    if (body.apiKey) values.apiKeyEncrypted = encryptSecret(body.apiKey);
    const [row] = await db
      .update(providers)
      .set(values)
      .where(and(eq(providers.id, id), eq(providers.ownerId, request.user.sub)))
      .returning({ id: providers.id, name: providers.name, baseUrl: providers.baseUrl });
    if (!row) return reply.code(404).send({ error: "Proveedor no encontrado" });
    return row;
  });

  app.delete("/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(providers).where(and(eq(providers.id, id), eq(providers.ownerId, request.user.sub)));
    return reply.code(204).send();
  });

  // Test de conexión real contra el endpoint /models del proveedor.
  app.post("/providers/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db
      .select()
      .from(providers)
      .where(and(eq(providers.id, id), eq(providers.ownerId, request.user.sub)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Proveedor no encontrado" });
    try {
      const list = await fetchProviderModels(row);
      return { ok: true, models: list.length, sample: list.slice(0, 8) };
    } catch (error) {
      return reply.code(502).send({ ok: false, error: error instanceof Error ? error.message : "Error de conexión" });
    }
  });

  // Sincroniza los modelos del proveedor con la plataforma.
  app.post("/providers/:id/sync", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db
      .select()
      .from(providers)
      .where(and(eq(providers.id, id), eq(providers.ownerId, request.user.sub)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Proveedor no encontrado" });
    try {
      const remote = await fetchProviderModels(row);
      const existing = await db.select({ modelId: models.modelId }).from(models).where(eq(models.providerId, id));
      const existingIds = new Set(existing.map((e) => e.modelId));
      const toCreate = remote
        .map((name) => (name.includes("/") ? name : name).trim())
        .filter((name) => name && !existingIds.has(name) && !existingIds.has(`${name}`))
        .map((name) => ({
          providerId: id,
          modelId: name,
          displayName: name,
          capabilities: capabilitiesFor(name) as never,
        }));
      if (toCreate.length > 0) await db.insert(models).values(toCreate);
      return { ok: true, found: remote.length, created: toCreate.length };
    } catch (error) {
      return reply.code(502).send({ ok: false, error: error instanceof Error ? error.message : "Error de sincronización" });
    }
  });
}
