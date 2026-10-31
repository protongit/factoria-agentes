import { db, projects, runEvents, stepRuns, workflowRuns } from "@factoria/db";
import { runAlertMessage, runAlertNextSteps, type RunAlertKind } from "@factoria/core";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const DAY_MS = 24 * 60 * 60 * 1000;

interface SnapshotNode {
  key?: string;
  name?: string;
}

function nodeName(snapshot: unknown, key: string | null | undefined): string | undefined {
  if (!key || !snapshot || typeof snapshot !== "object") return undefined;
  const nodes = (snapshot as { nodes?: SnapshotNode[] }).nodes;
  return Array.isArray(nodes) ? nodes.find((n) => n?.key === key)?.name : undefined;
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  // Avisos recientes de las ejecuciones del usuario: aprobaciones pendientes,
  // fallos, ejecuciones terminadas y canceladas.
  app.get("/notifications", async (request) => {
    const runs = await db
      .select({
        id: workflowRuns.id,
        projectId: workflowRuns.projectId,
        status: workflowRuns.status,
        createdAt: workflowRuns.createdAt,
        finishedAt: workflowRuns.finishedAt,
        graphSnapshot: workflowRuns.graphSnapshot,
        projectName: projects.name,
      })
      .from(workflowRuns)
      .innerJoin(projects, eq(projects.id, workflowRuns.projectId))
      .where(
        and(
          eq(projects.ownerId, request.user.sub),
          inArray(workflowRuns.status, ["failed", "succeeded", "cancelled", "paused"]),
          gte(workflowRuns.createdAt, new Date(Date.now() - 7 * DAY_MS)),
        ),
      )
      .orderBy(desc(workflowRuns.createdAt))
      .limit(40);

    if (runs.length === 0) return { alerts: [] };

    const runIds = runs.map((r) => r.id);
    const [steps, errors] = await Promise.all([
      db.select().from(stepRuns).where(inArray(stepRuns.runId, runIds)),
      db
        .select({ runId: runEvents.runId, message: runEvents.message })
        .from(runEvents)
        .where(and(inArray(runEvents.runId, runIds), eq(runEvents.level, "error")))
        .orderBy(desc(runEvents.seq)),
    ]);

    const lastError = new Map<string, string>();
    for (const e of errors) if (!lastError.has(e.runId)) lastError.set(e.runId, e.message);

    const alerts: Array<{
      id: string;
      kind: RunAlertKind;
      runId: string;
      projectId: string;
      projectName: string;
      nodeKey?: string;
      nodeName?: string;
      message: string;
      error?: string;
      createdAt: string;
      nextSteps: string[];
      href: string;
    }> = [];

    for (const run of runs) {
      const runSteps = steps.filter((s) => s.runId === run.id);
      const waiting = runSteps.filter((s) => s.status === "waiting_approval");
      const failed = runSteps.filter((s) => s.status === "failed");

      if (waiting.length > 0) {
        for (const step of waiting) {
          const ctx = {
            projectName: run.projectName,
            kind: "approval" as const,
            nodeKey: step.nodeKey,
            nodeName: nodeName(run.graphSnapshot, step.nodeKey),
          };
          alerts.push({
            id: `${run.id}:approval:${step.id}`,
            kind: "approval",
            runId: run.id,
            projectId: run.projectId,
            projectName: run.projectName,
            nodeKey: step.nodeKey,
            nodeName: ctx.nodeName,
            message: runAlertMessage(ctx),
            createdAt: (step.startedAt ?? run.createdAt).toISOString(),
            nextSteps: runAlertNextSteps(ctx),
            href: `/projects/${run.projectId}?tab=runs&run=${run.id}`,
          });
        }
        continue;
      }

      // Un run en pausa sin pasos pendientes de aprobación es una pausa manual.
      if (run.status === "paused") continue;

      const kind: RunAlertKind = run.status === "failed" ? "failed" : run.status === "succeeded" ? "succeeded" : "cancelled";
      const failedStep = failed[failed.length - 1];
      const error = failedStep?.error || lastError.get(run.id) || undefined;
      const ctx = {
        projectName: run.projectName,
        kind,
        nodeKey: failedStep?.nodeKey,
        nodeName: nodeName(run.graphSnapshot, failedStep?.nodeKey),
        reason: error,
      };
      alerts.push({
        id: `${run.id}:${kind}`,
        kind,
        runId: run.id,
        projectId: run.projectId,
        projectName: run.projectName,
        nodeKey: ctx.nodeKey,
        nodeName: ctx.nodeName,
        message: runAlertMessage(ctx),
        error,
        createdAt: (run.finishedAt ?? run.createdAt).toISOString(),
        nextSteps: runAlertNextSteps(ctx),
        href: `/projects/${run.projectId}?tab=runs&run=${run.id}`,
      });
    }

    alerts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { alerts: alerts.slice(0, 50) };
  });
}
