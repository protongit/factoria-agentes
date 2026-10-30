import { db, projects } from "@factoria/db";
import { and, eq } from "drizzle-orm";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";

const MAX_CONTENT_BYTES = 400_000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function mimeFor(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

async function ownedProject(request: FastifyRequest, id: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, request.user.sub)))
    .limit(1);
  return row;
}

/** Resuelve una ruta relativa dentro del workspace, sin escaparse. */
function resolveSafe(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel ?? ".");
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) return null;
  return abs;
}

function detectBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8000);
  if (sample.includes(0)) return true;
  const text = sample.toString("utf8");
  const weird = (text.match(/\uFFFD/g) ?? []).length;
  return weird > Math.max(2, sample.length * 0.01);
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  // Listado de un directorio del workspace.
  app.get("/projects/:id/files", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const root = project.workspaceRoot ?? "";
    if (!root || !existsSync(root)) {
      return { path: "", exists: false, entries: [] };
    }
    const rel = ((request.query as { path?: string }).path ?? "").replace(/^\/+/, "");
    const abs = resolveSafe(root, rel);
    if (!abs) return reply.code(400).send({ error: "Ruta inválida" });
    if (!existsSync(abs)) return reply.code(404).send({ error: "La ruta no existe" });
    if (!statSync(abs).isDirectory()) return reply.code(400).send({ error: "La ruta no es un directorio" });

    const entries = readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.name !== ".git")
      .map((e) => {
        const full = path.join(abs, e.name);
        let size = 0;
        let mtime = 0;
        try {
          const st = statSync(full);
          size = st.size;
          mtime = st.mtimeMs;
        } catch { /* enlace roto */ }
        return { name: e.name, type: e.isDirectory() ? ("dir" as const) : ("file" as const), size, mtime };
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));

    return { path: rel, exists: true, entries };
  });

  // Contenido de un fichero del workspace.
  app.get("/projects/:id/file", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const root = project.workspaceRoot ?? "";
    if (!root || !existsSync(root)) return reply.code(404).send({ error: "El workspace no está inicializado" });

    const rel = ((request.query as { path?: string }).path ?? "").replace(/^\/+/, "");
    if (!rel) return reply.code(400).send({ error: "Falta la ruta del fichero" });
    const abs = resolveSafe(root, rel);
    if (!abs) return reply.code(400).send({ error: "Ruta inválida" });
    if (!existsSync(abs) || !statSync(abs).isFile()) return reply.code(404).send({ error: "El fichero no existe" });

    const st = statSync(abs);
    const buf = readFileSync(abs);
    const binary = detectBinary(buf);
    const truncated = buf.length > MAX_CONTENT_BYTES;
    const shown = truncated ? buf.subarray(0, MAX_CONTENT_BYTES) : buf;
    return {
      path: rel,
      size: st.size,
      mtime: st.mtimeMs,
      binary,
      truncated,
      content: binary ? null : shown.toString("utf8"),
    };
  });

  // Información de la app del proyecto (estática o con servidor).
  app.get("/projects/:id/preview-info", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const root = project.workspaceRoot ?? "";
    const exists = Boolean(root && existsSync(root));
    let scripts: Record<string, string> = {};
    let hasPackageJson = false;
    if (exists) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
          scripts?: Record<string, string>;
        };
        scripts = pkg.scripts ?? {};
        hasPackageJson = true;
      } catch {
        hasPackageJson = false;
      }
    }
    return {
      exists,
      hasIndex: exists && existsSync(path.join(root, "index.html")),
      hasPackageJson,
      scripts,
      devCommand: project.devCommand ?? "",
      devPort: project.devPort ?? 3000,
    };
  });

  // Vista previa de la app estática del proyecto.
  app.get("/projects/:id/preview", async (request, reply) => {
    return servePreview(request, reply, "index.html");
  });

  app.get("/projects/:id/preview/*", async (request, reply) => {
    const wildcard = (request.params as { "*"?: string })["*"] ?? "";
    return servePreview(request, reply, wildcard || "index.html");
  });

  // Descarga del proyecto en .tar.gz (sin .git, node_modules, .worktrees ni secretos).
  app.get("/projects/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await ownedProject(request, id);
    if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
    const root = project.workspaceRoot ?? "";
    if (!root || !existsSync(root)) return reply.code(404).send({ error: "El workspace no está inicializado" });
    const slug =
      project.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "proyecto";
    reply
      .header("Content-Disposition", `attachment; filename="${slug}.tar.gz"`)
      .header("Cache-Control", "no-store")
      .type("application/gzip");
    const child = spawn("tar", [
      "-czf",
      "-",
      "--exclude=.git",
      "--exclude=node_modules",
      "--exclude=.worktrees",
      "--exclude=.factoria",
      "--exclude=.env",
      "-C",
      root,
      ".",
    ]);
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.warn(`[download] ${text.slice(0, 200)}`);
    });
    child.on("error", (error) => {
      console.error(`[download] ${error.message}`);
      reply.raw.destroy(error);
    });
    return reply.send(child.stdout);
  });
}

function isSensitivePreviewPath(rel: string): boolean {
  const parts = rel.split("/").filter(Boolean);
  if (parts.some((part) => part === ".git" || part === ".worktrees" || part === "node_modules")) return true;
  if (parts[0] === ".factoria") return true;
  if (parts[0] === ".env" || parts[0]?.startsWith(".env.")) return true;
  return false;
}

async function servePreview(
  request: FastifyRequest,
  reply: import("fastify").FastifyReply,
  entry: string,
) {
  const { id } = request.params as { id: string };
  const project = await ownedProject(request, id);
  if (!project) return reply.code(404).send({ error: "Proyecto no encontrado" });
  const root = project.workspaceRoot ?? "";
  if (!root || !existsSync(root)) return reply.code(404).send({ error: "El workspace no está inicializado" });

  let rel = (entry ?? "").replace(/^\/+/, "");
  if (!rel) rel = "index.html";
  if (rel.endsWith("/")) rel += "index.html";
  if (isSensitivePreviewPath(rel)) return reply.code(404).send({ error: "La ruta no existe" });

  let abs = resolveSafe(root, rel);
  if (!abs) return reply.code(400).send({ error: "Ruta inválida" });
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    rel = `${rel.replace(/\/+$/, "")}/index.html`;
    if (isSensitivePreviewPath(rel)) return reply.code(404).send({ error: "La ruta no existe" });
    abs = resolveSafe(root, rel);
    if (!abs) return reply.code(400).send({ error: "Ruta inválida" });
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) return reply.code(404).send({ error: "El fichero no existe" });

  reply.header("Cache-Control", "no-store").type(mimeFor(abs));
  return reply.send(createReadStream(abs));
}
