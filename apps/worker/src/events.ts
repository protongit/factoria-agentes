import IORedis from "ioredis";

let publisher: IORedis | null = null;

export function getPublisher(): IORedis {
  if (!publisher) {
    publisher = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return publisher;
}

export interface PublishedEvent {
  seq: number;
  level: string;
  source: string;
  message: string;
  stepRunId?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt?: string;
}

export const RUN_CHANNEL = (runId: string) => `run:${runId}`;

export async function publishRunEvent(runId: string, event: PublishedEvent): Promise<void> {
  try {
    await getPublisher().publish(RUN_CHANNEL(runId), JSON.stringify(event));
  } catch (error) {
    console.error("[events] no se pudo publicar el evento:", error instanceof Error ? error.message : error);
  }
}
