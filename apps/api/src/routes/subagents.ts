import { db, subagents } from "@factoria/db";
import {
  SUBAGENT_TEMPLATES,
  subagentToClaudeMarkdown,
  subagentToCodexToml,
  subagentToOpenCodeMarkdown,
} from "@factoria/core";
import { createSubagentSchema } from "@factoria/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export async function subagentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/subagents", async (request) => {
    return db
      .select()
      .from(subagents)
      .where(eq(subagents.ownerId, request.user.sub))
      .orderBy(desc(subagents.createdAt));
  });

  app.get("/subagents/templates", async () => SUBAGENT_TEMPLATES);

  app.post("/subagents", async (request, reply) => {
    const parsed = createSubagentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    const d = parsed.data;
    const [row] = await db
      .insert(subagents)
      .values({
        ownerId: request.user.sub,
        name: d.name,
        description: d.description,
        instructions: d.instructions,
        category: d.category,
        defaultModelId: d.defaultModelId,
        temperature: d.temperature?.toString(),
        permissions: d.permissions as never,
        allowedTools: d.allowedTools,
        outputContract: d.outputContract,
        canDelegateTo: d.canDelegateTo,
        maxDepth: d.maxDepth,
        skills: d.skills,
        mcpServers: d.mcpServers,
        mode: d.mode,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.post("/subagents/seed", async (request, reply) => {
    const existing = await db.select({ name: subagents.name }).from(subagents).where(eq(subagents.ownerId, request.user.sub));
    const names = new Set(existing.map((e) => e.name));
    const toCreate = SUBAGENT_TEMPLATES.filter((t) => !names.has(t.name));
    if (toCreate.length === 0) return reply.send({ created: 0 });
    await db.insert(subagents).values(
      toCreate.map((t) => ({
        ownerId: request.user.sub,
        name: t.name,
        description: t.description,
        instructions: t.instructions,
        category: t.category,
        permissions: t.permissions as never,
        mode: "subagent" as const,
      })),
    );
    return reply.code(201).send({ created: toCreate.length });
  });

  app.get("/subagents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db
      .select()
      .from(subagents)
      .where(and(eq(subagents.id, id), eq(subagents.ownerId, request.user.sub)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Subagente no encontrado" });
    return row;
  });

  app.patch("/subagents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createSubagentSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Datos inválidos", details: parsed.error.flatten() });
    const d = parsed.data;
    const values: Record<string, unknown> = {};
    for (const key of ["name", "description", "instructions", "category", "defaultModelId", "outputContract", "maxDepth", "mode"] as const) {
      if (d[key] !== undefined) values[key] = d[key];
    }
    if (d.permissions) values.permissions = d.permissions;
    if (d.allowedTools) values.allowedTools = d.allowedTools;
    if (d.canDelegateTo) values.canDelegateTo = d.canDelegateTo;
    if (d.skills) values.skills = d.skills;
    if (d.mcpServers) values.mcpServers = d.mcpServers;
    if (d.temperature !== undefined) values.temperature = d.temperature?.toString();
    const [row] = await db
      .update(subagents)
      .set(values)
      .where(and(eq(subagents.id, id), eq(subagents.ownerId, request.user.sub)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Subagente no encontrado" });
    return row;
  });

  app.delete("/subagents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(subagents).where(and(eq(subagents.id, id), eq(subagents.ownerId, request.user.sub)));
    return reply.code(204).send();
  });

  // Materializa un subagente al formato nativo de un ejecutor.
  app.get("/subagents/:id/materialize", async (request, reply) => {
    const { id } = request.params as { id: string };
    const target = (request.query as { target?: string }).target ?? "opencode";
    const [row] = await db
      .select()
      .from(subagents)
      .where(and(eq(subagents.id, id), eq(subagents.ownerId, request.user.sub)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Subagente no encontrado" });
    const like = {
      name: row.name,
      description: row.description,
      instructions: row.instructions,
      category: row.category,
      defaultModelId: row.defaultModelId,
      temperature: row.temperature,
      permissions: row.permissions as never,
      outputContract: row.outputContract,
      mcpServers: row.mcpServers,
      skills: row.skills,
    };
    if (target === "claude") return { filename: `.claude/agents/${row.name}.md`, content: subagentToClaudeMarkdown(like) };
    if (target === "codex") return { filename: `.codex/agents/${row.name}.toml`, content: subagentToCodexToml(like) };
    return { filename: `.opencode/agent/${row.name}.md`, content: subagentToOpenCodeMarkdown(like) };
  });
}
