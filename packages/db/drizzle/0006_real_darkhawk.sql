ALTER TABLE "assistant_messages" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_messages_dedupe_idx" ON "assistant_messages" USING btree ("dedupe_key");