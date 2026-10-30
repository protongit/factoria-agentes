import {
  agentClaims,
  architectureDecisions,
  contracts,
  db,
  policyDecisions,
  policyRules,
  projects,
  reviewVerdicts,
} from "@factoria/db";
import {
  adrPath,
  appendEntry,
  extractRulesFromMarkdown,
  nextAdrNumber,
  parsePolicy,
  renderAdr,
  report,
  stewardSweep,
  type LedgerEntry,
} from "@factoria/core";
import type { ContractStatus } from "@factoria/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";

async function ownedProject(request: FastifyRequest, id: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, request.user.sub)))
    .limit(1);
  return row;
}

function toLedger(rows: (typeof policyDecisions.$inferSelect)[]): LedgerEntry[] {
  return rows.map((r) => ({
    seq: r.seq,
    gate: r.gate as LedgerEntry["gate"],
    outcome: r.outcome as LedgerEntry["outcome"],
    reason: r.reason,
    ruleId: r.ruleId ?? undefined,
    klass: r.klass ?? undefined,
    payload: r.payload ?? undefined,
    createdAt: r.createdAt.toISOString(),
    prevHash: r.prevHash ?? undefined,
    hash: r.hash,
  }));
}

export async function methodRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  // --- Gobernanza: ledger encadenado ---
  app.get("/projects/:id/governance", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const rows = await db
      .select()
      .from(policyDecisions)
      .where(eq(policyDecisions.projectId, id))
      .orderBy(asc(policyDecisions.seq));
    const entries = toLedger(rows);
    return { entries, report: report(entries) };
  });

  app.post("/projects/:id/governance/anchor", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const rows = await db
      .select()
      .from(policyDecisions)
      .where(eq(policyDecisions.projectId, id))
      .orderBy(asc(policyDecisions.seq));
    const entries = toLedger(rows);
    const rep = report(entries);
    const anchorPath = path.join(project.workspaceRoot ?? `/workspaces/${id}`, ".factoria", "policy-anchor.json");
    try {
      mkdirSync(path.dirname(anchorPath), { recursive: true });
      writeFileSync(anchorPath, JSON.stringify({ head: rep.head, total: rep.total, anchoredAt: new Date().toISOString() }, null, 2));
    } catch {
      /* workspace no montado */
    }
    return rep;
  });

  // --- Veredictos de revisión cross-AI ---
  app.get("/projects/:id/reviews", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    return db
      .select()
      .from(reviewVerdicts)
      .where(eq(reviewVerdicts.projectId, id))
      .orderBy(desc(reviewVerdicts.createdAt))
      .limit(100);
  });

  // --- ADRs ---
  app.get("/projects/:id/adrs", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    return db.select().from(architectureDecisions).where(eq(architectureDecisions.projectId, id)).orderBy(asc(architectureDecisions.number));
  });

  app.post("/projects/:id/adrs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const b = request.body as { title?: string; decision?: string; context?: string; consequences?: string; status?: string };
    if (!b.title || !b.decision) return reply.code(400).send({ error: "Faltan title y decision" });
    const existing = await db.select({ number: architectureDecisions.number }).from(architectureDecisions).where(eq(architectureDecisions.projectId, id));
    const number = nextAdrNumber(existing);
    const adr = {
      number,
      title: b.title,
      status: (b.status ?? "proposed") as "proposed",
      context: b.context ?? "",
      decision: b.decision,
      consequences: b.consequences ?? "",
    };
    const rel = adrPath(number, b.title);
    const abs = path.join(project.workspaceRoot ?? `/workspaces/${id}`, rel);
    try {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, renderAdr(adr));
    } catch {
      /* workspace no montado */
    }
    const [row] = await db
      .insert(architectureDecisions)
      .values({ projectId: id, number, title: b.title, status: adr.status, context: adr.context, decision: adr.decision, consequences: adr.consequences, gitPath: rel })
      .returning();
    return reply.code(201).send(row);
  });

  // --- Políticas / reglas compiladas ---
  app.get("/projects/:id/policies", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const rules = await db.select().from(policyRules).where(eq(policyRules.projectId, id)).orderBy(asc(policyRules.ruleId));
    const policyFile = path.join(project.workspaceRoot ?? `/workspaces/${id}`, ".factoria", "policy.yml");
    let fromFile: unknown[] = [];
    if (existsSync(policyFile)) {
      fromFile = parsePolicy(readFileSync(policyFile, "utf8"));
    }
    return { rules, fromFile };
  });

  app.post("/projects/:id/policies/compile", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const agentsFile = path.join(project.workspaceRoot ?? `/workspaces/${id}`, "AGENTS.md");
    const md = existsSync(agentsFile) ? readFileSync(agentsFile, "utf8") : "";
    const skeleton = extractRulesFromMarkdown(md, "AGENTS.md");
    for (const rule of skeleton) {
      await db
        .insert(policyRules)
        .values({ projectId: id, ruleId: rule.id, source: rule.source, literalText: rule.text, kind: "none", klass: "process" })
        .onConflictDoNothing();
    }
    return { proposed: skeleton.length };
  });

  app.post("/projects/:id/policies/:ruleId/approve", async (request, reply) => {
    const { id, ruleId } = request.params as { id: string; ruleId: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const [row] = await db
      .update(policyRules)
      .set({ approved: true })
      .where(and(eq(policyRules.projectId, id), eq(policyRules.ruleId, ruleId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Regla no encontrada" });
    return row;
  });

  // --- Claims ---
  app.get("/projects/:id/claims", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    return db.select().from(agentClaims).where(eq(agentClaims.projectId, id)).orderBy(desc(agentClaims.createdAt)).limit(100);
  });

  // --- Steward: barrido de garantías caducadas ---
  app.post("/projects/:id/steward/sweep", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await ownedProject(request, id))) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const now = new Date();
    const maxAgeMs = Number((request.body as { maxAgeMs?: number } | undefined)?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000);
    const list = await db.select().from(contracts).where(eq(contracts.projectId, id));
    const sweep = stewardSweep(
      list.map((c) => ({ id: c.id, title: c.title, status: c.status as ContractStatus, lastVerifiedAt: c.lastVerifiedAt, expiresAt: c.expiresAt })),
      now,
      maxAgeMs,
    );
    for (const change of sweep.changes) {
      await db.update(contracts).set({ status: "unknown" }).where(eq(contracts.id, change.id));
      const rows = await db.select().from(policyDecisions).where(eq(policyDecisions.projectId, id)).orderBy(asc(policyDecisions.seq));
      const entry = appendEntry(toLedger(rows), {
        gate: "steward",
        outcome: "deny",
        reason: `Garantía caducada: ${change.id}`,
        payload: { from: change.from, to: change.to },
      });
      await db.insert(policyDecisions).values({
        projectId: id,
        seq: entry.seq,
        gate: entry.gate as never,
        outcome: entry.outcome as never,
        reason: entry.reason,
        payload: entry.payload,
        prevHash: entry.prevHash,
        hash: entry.hash,
        createdAt: new Date(entry.createdAt ?? Date.now()),
      });
    }
    return sweep;
  });
}
