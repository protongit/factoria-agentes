CREATE TABLE "workflow_edit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"user_id" uuid,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_budgets" ADD COLUMN "webhook_url" text;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "kind" text DEFAULT 'flow' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "source_run_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "workflow_edit_history" ADD CONSTRAINT "workflow_edit_history_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edit_history" ADD CONSTRAINT "workflow_edit_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;