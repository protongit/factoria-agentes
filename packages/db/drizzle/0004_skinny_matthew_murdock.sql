CREATE TABLE "agent_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"step_run_id" uuid,
	"project_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "architecture_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"decision" text NOT NULL,
	"consequences" text DEFAULT '' NOT NULL,
	"git_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid,
	"step_run_id" uuid,
	"seq" integer NOT NULL,
	"gate" text NOT NULL,
	"outcome" text NOT NULL,
	"rule_id" text,
	"klass" text,
	"reason" text NOT NULL,
	"payload" jsonb,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"source" text NOT NULL,
	"literal_text" text NOT NULL,
	"kind" text DEFAULT 'none' NOT NULL,
	"klass" text DEFAULT 'process' NOT NULL,
	"gate" text,
	"condition" jsonb,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"container_id" text,
	"name" text,
	"status" text DEFAULT 'stopped' NOT NULL,
	"image" text,
	"network_mode" text DEFAULT 'closed' NOT NULL,
	"endpoint" text,
	"last_started_at" timestamp with time zone,
	"last_stopped_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_containers_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "review_verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"step_run_id" uuid,
	"project_id" uuid NOT NULL,
	"diff_hash" text NOT NULL,
	"verdict" text NOT NULL,
	"reviewer_model_id" text,
	"reviewer_family" text,
	"author_model_id" text,
	"summary" text,
	"confidence" numeric,
	"workspace" text DEFAULT 'root' NOT NULL,
	"arbitrated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_provider" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_username" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "container_image" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "container_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "container_network_mode" text DEFAULT 'closed' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "state_backend" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "board_name" text;--> statement-breakpoint
ALTER TABLE "agent_claims" ADD CONSTRAINT "agent_claims_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_claims" ADD CONSTRAINT "agent_claims_step_run_id_step_runs_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."step_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_claims" ADD CONSTRAINT "agent_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_decisions" ADD CONSTRAINT "architecture_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_step_run_id_step_runs_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."step_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_containers" ADD CONSTRAINT "project_containers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_verdicts" ADD CONSTRAINT "review_verdicts_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_verdicts" ADD CONSTRAINT "review_verdicts_step_run_id_step_runs_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."step_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_verdicts" ADD CONSTRAINT "review_verdicts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_verdicts_project_diff_idx" ON "review_verdicts" USING btree ("project_id","diff_hash");