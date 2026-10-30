import { db, models, providers } from "@factoria/db";
import { createModelSchema } from "@factoria/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/models", async (request) => {
    const query = request.query as { providerId?: string };
    const condition = query.providerId
      ? and(eq(providers.ownerId, request.user.sub), eq(models.providerId, query.providerId))
      : eq(providers.ownerId, request.user.sub);
    return db
      .select({
        id: models.id,
        providerId: models.providerId,
        modelId: models.modelId,
        displayName: models.displayName,
        contextWindow: models.contextWindow,
        capabilities: models.capabilities,
        enabled: models.enabled,
      })
      .from(models)
      .innerJoin(providers, eq(models.providerId, providers.id))
      .where(condition)
      .orderBy(desc(models.createdAt));
  });

  app.post("/models", async (request, reply) => {
    const parsed = createModelSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    const data = parsed.data;
    const [provider] = await db
      .select({ id: providers.id })
      .from(providers)
      .where(and(eq(providers.id, data.providerId), eq(providers.ownerId, request.user.sub)))
      .limit(1);
    if (!provider) return reply.code(404).send({ error: "Proveedor no encontrado" });
    const [row] = await db
      .insert(models)
      .values({
        providerId: data.providerId,
        modelId: data.modelId,
        displayName: data.displayName,
        contextWindow: data.contextWindow,
        capabilities: data.capabilities,
        costInputPer1M: data.costInputPer1M?.toString(),
        costOutputPer1M: data.costOutputPer1M?.toString(),
        enabled: data.enabled,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.patch("/models/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      displayName?: string;
      contextWindow?: number;
      capabilities?: string[];
      enabled?: boolean;
    };
    const [owned] = await db
      .select({ id: models.id })
      .from(models)
      .innerJoin(providers, eq(models.providerId, providers.id))
      .where(and(eq(models.id, id), eq(providers.ownerId, request.user.sub)))
      .limit(1);
    if (!owned) return reply.code(404).send({ error: "Modelo no encontrado" });
    const values: Record<string, unknown> = {};
    if (body.displayName) values.displayName = body.displayName;
    if (body.contextWindow !== undefined) values.contextWindow = body.contextWindow;
    if (body.capabilities) values.capabilities = body.capabilities;
    if (body.enabled !== undefined) values.enabled = body.enabled;
    const [row] = await db.update(models).set(values).where(eq(models.id, id)).returning();
    return row;
  });

  app.delete("/models/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [owned] = await db
      .select({ id: models.id })
      .from(models)
      .innerJoin(providers, eq(models.providerId, providers.id))
      .where(and(eq(models.id, id), eq(providers.ownerId, request.user.sub)))
      .limit(1);
    if (!owned) return reply.code(404).send({ error: "Modelo no encontrado" });
    await db.delete(models).where(eq(models.id, id));
    return reply.code(204).send();
  });
}
