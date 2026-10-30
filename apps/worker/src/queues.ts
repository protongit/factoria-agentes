export const QUEUE_RUN = "factoria-runs";
export const QUEUE_STEP = "factoria-steps";

export interface StepJobData {
  runId: string;
  nodeKey: string;
  iteration: number;
}

export interface RunJobData {
  runId: string;
  projectId: string;
}

export function redisConnection() {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  return { connection: { url } };
}

import { Queue } from "bullmq";

let _queue: Queue | null = null;
export function getQueue(): Queue {
  if (!_queue) _queue = new Queue(QUEUE_RUN, redisConnection());
  return _queue;
}

export async function enqueueRun(runId: string, projectId: string, jobId?: string): Promise<void> {
  await getQueue().add("run", { runId, projectId }, { jobId: jobId ?? runId, removeOnComplete: 100, removeOnFail: 1000 });
}
