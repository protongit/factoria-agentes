import { Queue } from "bullmq";

export const QUEUE_RUN = "factoria-runs";

let queue: Queue | null = null;

export function getRunQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_RUN, {
      connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
    });
  }
  return queue;
}

export async function enqueueRun(runId: string, projectId: string, jobId?: string): Promise<void> {
  await getRunQueue().add(
    "run",
    { runId, projectId },
    { jobId: jobId ?? runId, removeOnComplete: 100, removeOnFail: 1000 },
  );
}
