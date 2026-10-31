import { assistantMessages, db } from "@factoria/db";
import { buildRunBriefing, type RunAlertContext } from "@factoria/core";

interface BriefingInput extends RunAlertContext {
  projectId: string;
  runId: string;
  /** Clave estable para no duplicar el aviso (p. ej. run:<id>:failed). */
  dedupeKey: string;
}

/** Publica un aviso del asistente en el proyecto, sin duplicarlo. */
export async function postRunBriefing(input: BriefingInput): Promise<void> {
  await db
    .insert(assistantMessages)
    .values({
      projectId: input.projectId,
      runId: input.runId,
      dedupeKey: input.dedupeKey,
      role: "assistant",
      content: buildRunBriefing(input),
    })
    .onConflictDoNothing({ target: assistantMessages.dedupeKey });
}
