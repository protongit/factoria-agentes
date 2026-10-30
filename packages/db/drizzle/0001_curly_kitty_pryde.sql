ALTER TABLE "projects" ADD COLUMN "repo_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_branch" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "long_term_memory_embedding_idx" ON "long_term_memory" USING hnsw ("embedding" vector_cosine_ops);
