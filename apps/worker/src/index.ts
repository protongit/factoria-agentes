import { db, stepRuns, workflowRuns } from "@factoria/db";
import { Queue, Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import IORedis from "ioredis";
import { abortRun, processRun, requestPause } from "./orchestrator.ts";
import { ensureOpencodeServer, stopOpencodeServer } from "./opencode-runtime.ts";
import { QUEUE_RUN, redisConnection, type RunJobData } from "./queues.ts";

const connection = redisConnection();
const worker = new Worker<RunJobData>(
  QUEUE_RUN,
  async (job) => {
    try {
      await processRun(job.data);
    } catch (error) {
      console.error(`[worker] job ${job.id} falló:`, error instanceof Error ? error.message : error);
      // Durabilidad: nunca dejar el run colgado en "running" si el job lanza.
      try {
        await db.update(stepRuns).set({ status: "failed" }).where(and(eq(stepRuns.runId, job.data.runId), eq(stepRuns.status, "running")));
        await db.update(workflowRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(workflowRuns.id, job.data.runId));
      } catch { /* best-effort */ }
    }
  },
  { ...connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) },
);

// Durabilidad: al arrancar, reencola los runs que quedaron en "running"
// (p. ej. tras un reinicio) para reanudarlos desde el estado persistido.
async function reconcile(): Promise<void> {
  try {
    const queue = new Queue(QUEUE_RUN, connection);
    const running = await db.select().from(workflowRuns).where(eq(workflowRuns.status, "running"));
    for (const run of running) {
      await db
        .update(stepRuns)
        .set({ status: "pending" })
        .where(and(eq(stepRuns.runId, run.id), eq(stepRuns.status, "running")));
      await queue.add("run", { runId: run.id, projectId: run.projectId }, { jobId: `resume-${run.id}-${Date.now()}` });
    }
    if (running.length) console.log(`[worker] reencolados ${running.length} runs inacabados`);
  } catch (error) {
    console.error("[worker] reconciliación falló:", error instanceof Error ? error.message : error);
  }
}

// Canal de control: cancelar aborta las sesiones activas; pausar detiene el despacho.
async function subscribeControl(): Promise<void> {
  try {
    const sub = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
    await sub.subscribe("factoria-control");
    sub.on("message", (_channel, message) => {
      try {
        const { runId, action } = JSON.parse(message) as { runId: string; action: "cancel" | "pause" };
        if (action === "cancel") abortRun(runId);
        if (action === "pause") requestPause(runId);
      } catch { /* mensaje inválido */ }
    });
  } catch (error) {
    console.error("[worker] suscripción de control falló:", error instanceof Error ? error.message : error);
  }
}

worker.on("ready", () => {
  console.log(`[worker] escuchando la cola ${QUEUE_RUN}`);
  void (async () => {
    await reconcile();
    await subscribeControl();
    const url = await ensureOpencodeServer();
    if (!url) console.log("[worker] sin servidor opencode: se usará el ejecutor simulado");
  })();
});

worker.on("failed", (job, error) => {
  console.error(`[worker] job ${job?.id} falló:`, error.message);
});

process.on("SIGTERM", async () => {
  stopOpencodeServer();
  await worker.close();
  process.exit(0);
});
