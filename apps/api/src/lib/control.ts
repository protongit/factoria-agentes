import IORedis from "ioredis";

export const CONTROL_CHANNEL = "factoria-control";

let publisher: IORedis | null = null;

function getPublisher(): IORedis {
  if (!publisher) {
    publisher = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  }
  return publisher;
}

/** Publica una orden de control para el worker (cancel/pause). */
export async function publishControl(runId: string, action: "cancel" | "pause"): Promise<void> {
  try {
    await getPublisher().publish(CONTROL_CHANNEL, JSON.stringify({ runId, action }));
  } catch {
    /* best-effort */
  }
}
