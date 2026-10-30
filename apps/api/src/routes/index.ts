import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.ts";
import { fileRoutes } from "./files.ts";
import { healthRoutes } from "./health.ts";
import { methodRoutes } from "./method.ts";
import { modelRoutes } from "./models.ts";
import { projectRoutes } from "./projects.ts";
import { providerRoutes } from "./providers.ts";
import { runRoutes } from "./runs.ts";
import { subagentRoutes } from "./subagents.ts";
import { workflowRoutes } from "./workflows.ts";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(providerRoutes);
  await app.register(modelRoutes);
  await app.register(subagentRoutes);
  await app.register(workflowRoutes);
  await app.register(projectRoutes);
  await app.register(methodRoutes);
  await app.register(fileRoutes);
  await app.register(runRoutes);
}
