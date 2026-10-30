ALTER TABLE "projects" ADD COLUMN "dev_command" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "dev_port" integer DEFAULT 3000 NOT NULL;