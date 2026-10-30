import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { contracts, db, documentChunks, documents, longTermMemory, models, projectFeatures, providers } from "@factoria/db";
import {
  cloneWithAuth,
  decryptSecret,
  embedTexts,
  fitDimensions,
  hookFiles,
  installGitHooks,
  type GitAuth,
  type ProviderEndpoint,
} from "@factoria/core";
import type { RepoProvider } from "@factoria/shared";
import { and, desc, eq, sql } from "drizzle-orm";

export interface ProjectLike {
  id: string;
  ownerId: string;
  name: string;
  objective: string;
  description: string | null;
  stack: string[];
  workspaceRoot: string | null;
  repoUrl: string | null;
  repoBranch: string | null;
  repoProvider?: RepoProvider | null;
  repoTokenEncrypted?: string | null;
  embeddingModelId: string | null;
  assistantModelId: string | null;
}

/** Credenciales Git efímeras del proyecto (token descifrado en memoria). */
export function gitAuthForProject(project: Pick<ProjectLike, "repoUrl" | "repoProvider" | "repoTokenEncrypted">): GitAuth | undefined {
  if (!project.repoUrl || !project.repoTokenEncrypted) return undefined;
  try {
    return { provider: project.repoProvider ?? "other", token: decryptSecret(project.repoTokenEncrypted) };
  } catch {
    return undefined;
  }
}

export async function modelEndpoint(
  ownerId: string,
  modelId: string,
): Promise<{ provider: ProviderEndpoint; modelId: string; providerId: string } | null> {
  const [row] = await db
    .select({ baseUrl: providers.baseUrl, apiKeyEncrypted: providers.apiKeyEncrypted, modelId: models.modelId, providerName: providers.name })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(and(eq(models.id, modelId), eq(providers.ownerId, ownerId)))
    .limit(1);
  if (!row) return null;
  const providerId = row.providerName.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "provider";
  let apiKey: string;
  try {
    apiKey = decryptSecret(row.apiKeyEncrypted);
  } catch {
    // Clave ilegible (p. ej. cifrada con otra SECRETS_ENCRYPTION_KEY): endpoint no usable.
    return null;
  }
  return {
    provider: { baseUrl: row.baseUrl ?? "https://api.openai.com/v1", apiKey },
    modelId: row.modelId,
    providerId,
  };
}

function git(dir: string, args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Prepara el workspace del proyecto: directorio, repo git local, hooks y AGENTS.md. */
export function ensureWorkspace(project: ProjectLike): string {
  const root = project.workspaceRoot ?? `/workspaces/${project.id}`;
  mkdirSync(root, { recursive: true });

  const auth = gitAuthForProject(project);
  const hasGit = existsSync(path.join(root, ".git"));
  if (!hasGit && project.repoUrl) {
    const isLocal = !/^(https?|ssh|git@)/.test(project.repoUrl) && existsSync(project.repoUrl);
    if (isLocal) {
      const ok = git(root, ["clone", project.repoUrl, "."]);
      if (!ok) git(root, ["init"]);
    } else if (/^(https?|ssh|git@)/.test(project.repoUrl)) {
      const ok = cloneWithAuth(root, project.repoUrl, auth, project.repoBranch).ok;
      if (!ok) git(root, ["init"]);
    } else {
      git(root, ["init"]);
    }
  }
  if (!existsSync(path.join(root, ".git"))) git(root, ["init"]);
  git(root, ["config", "user.email", "bot@factoria.dev"]);
  git(root, ["config", "user.name", "Factoría"]);

  // Método: hooks deterministas (review gate, política de commits, pre-push).
  installGitHooks(root, hookFiles());

  const agents = [
    `# ${project.name}`,
    "",
    `Objetivo: ${project.objective}`,
    project.description ? `Descripción: ${project.description}` : "",
    project.stack.length ? `Stack: ${project.stack.join(", ")}` : "",
    "",
    "Trabaja dentro de este directorio. Respeta las convenciones del proyecto y deja el código compilable.",
    "",
    "## Reglas del método (obligatorias)",
    "",
    "- Crea/usa una tarjeta de trabajo antes de tocar código (card-first).",
    "- Consulta el RAG antes de asumir cómo funciona el código (rag-first).",
    "- Escribe ficheros con las herramientas de edición, no por Bash (bash-write).",
    "- No uses `git commit --no-verify` ni desactives `core.hooksPath`.",
    "- Todo commit lo revisa una IA distinta a la autora (review gate).",
    "- Prohibida cualquier atribución de IA en commits o PRs.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  writeFileSync(path.join(root, "AGENTS.md"), agents + "\n");

  // Política del proyecto (gobernanza; solo el usuario puede cambiarla).
  const policyDir = path.join(root, ".factoria");
  mkdirSync(policyDir, { recursive: true });
  if (!existsSync(path.join(policyDir, "policy.yml"))) {
    writeFileSync(
      path.join(policyDir, "policy.yml"),
      [
        "# Política del proyecto (gestionada por Factoría de Agentes).",
        "# Solo el usuario puede modificar este fichero.",
        "- id: no-force-push",
        "  source: AGENTS.md",
        '  text: "No usar git push --force"',
        "  kind: deterministic",
        "  class: security",
        "  gate: commit-gate",
        "  tool: bash",
        '  contains: "push --force"',
        "",
      ].join("\n"),
    );
  }
  return root;
}

export function ensureDir(base: string, sub: string): string {
  const dir = sub && sub !== "." ? path.join(base, sub) : base;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Contexto del proyecto para los prompts: features, contratos, memoria y RAG. */
export async function buildContext(project: ProjectLike, ownerId: string, query: string, topK = 5): Promise<string> {
  const parts: string[] = [];

  const features = await db
    .select({ title: projectFeatures.title, status: projectFeatures.status })
    .from(projectFeatures)
    .where(eq(projectFeatures.projectId, project.id))
    .orderBy(projectFeatures.priority);
  if (features.length) parts.push(`Funcionalidades:\n${features.map((f) => `- [${f.status}] ${f.title}`).join("\n")}`);

  const contractRows = await db
    .select({ title: contracts.title, criterion: contracts.criterion, status: contracts.status })
    .from(contracts)
    .where(eq(contracts.projectId, project.id))
    .orderBy(contracts.order);
  if (contractRows.length) {
    parts.push(`Contratos (criterios de aceptación):\n${contractRows.map((c) => `- [${c.status}] ${c.title}: ${c.criterion}`).join("\n")}`);
  }

  // Memoria de largo plazo (semántica si hay embeddings, si no las últimas).
  if (project.embeddingModelId) {
    const ep = await modelEndpoint(ownerId, project.embeddingModelId);
    if (ep) {
      try {
        const [v] = await embedTexts(ep.provider, ep.modelId, [query || project.objective]);
        if (v) {
          const vec = fitDimensions(v);
          const mem = await db
            .select({ content: longTermMemory.content })
            .from(longTermMemory)
            .where(eq(longTermMemory.projectId, project.id))
            .orderBy(sql`${longTermMemory.embedding} <=> ${sql.raw(`'[${vec.join(",")}]'::vector`)}`)
            .limit(3);
          if (mem.length) parts.push(`Memoria relevante:\n${mem.map((m) => `- ${m.content}`).join("\n")}`);
        }
      } catch { /* sin memoria semántica */ }
    }
  }

  // RAG: fragmentos de documentación relevantes para la tarea.
  if (project.embeddingModelId && (query || project.objective)) {
    const ep = await modelEndpoint(ownerId, project.embeddingModelId);
    if (ep) {
      try {
        const [v] = await embedTexts(ep.provider, ep.modelId, [query || project.objective]);
        if (v) {
          const vec = fitDimensions(v);
          const chunks = await db
            .select({ title: documents.title, content: documentChunks.content })
            .from(documentChunks)
            .innerJoin(documents, eq(documentChunks.documentId, documents.id))
            .where(eq(documentChunks.projectId, project.id))
            .orderBy(sql`${documentChunks.embedding} <=> ${sql.raw(`'[${vec.join(",")}]'::vector`)}`)
            .limit(topK);
          if (chunks.length) {
            parts.push(`Documentación relevante:\n${chunks.map((c) => `### ${c.title}\n${c.content.slice(0, 400)}`).join("\n")}`);
          }
        }
      } catch { /* sin RAG */ }
    }
  }

  const text = parts.join("\n\n");
  return text.length > 6000 ? `${text.slice(0, 6000)}…` : text;
}

/** Últimos recuerdos sin embeddings (fallback). */
export async function latestMemory(projectId: string, limit = 5): Promise<string[]> {
  const rows = await db
    .select({ content: longTermMemory.content })
    .from(longTermMemory)
    .where(eq(longTermMemory.projectId, projectId))
    .orderBy(desc(longTermMemory.createdAt))
    .limit(limit);
  return rows.map((r) => r.content);
}

/** Modelos (id de catálogo, modelId y capacidades) disponibles para el owner. */
export async function ownerModels(ownerId: string): Promise<{ id: string; modelId: string; capabilities: string[] }[]> {
  const rows = await db
    .select({ id: models.id, modelId: models.modelId, capabilities: models.capabilities })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(and(eq(providers.ownerId, ownerId), eq(models.enabled, true)));
  return rows;
}
