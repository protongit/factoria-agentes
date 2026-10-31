import { contracts, db, documents, longTermMemory, projectFeatures, projects, runEvents, workflowRuns } from "@factoria/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { createInterface } from "node:readline";

/**
 * Servidor MCP (Model Context Protocol) del Project Info, por stdio (JSON-RPC).
 * Expone la información del proyecto a agentes y subagentes.
 *
 * Uso: configurar en el ejecutor (p. ej. opencode) un servidor MCP local:
 *   command: ["node", "--import", "tsx", "/app/apps/mcp/src/index.ts"]
 * Las tools reciben `project_id`.
 */

const PROTOCOL_VERSION = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  { name: "get_project", description: "Datos del proyecto (objetivo, stack, estado).", inputSchema: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] } },
  { name: "list_features", description: "Funcionalidades del proyecto.", inputSchema: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] } },
  { name: "list_contracts", description: "Contratos y su estado.", inputSchema: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] } },
  { name: "list_documents", description: "Documentos del proyecto.", inputSchema: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] } },
  { name: "list_runs", description: "Ejecuciones del proyecto.", inputSchema: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] } },
  { name: "get_run_log", description: "Log de eventos y errores de la última ejecución (o de una ejecución concreta).", inputSchema: { type: "object", properties: { project_id: { type: "string" }, run_id: { type: "string" }, limit: { type: "number" } }, required: ["project_id"] } },
  { name: "search_project_docs", description: "Búsqueda sobre la documentación del proyecto.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, query: { type: "string" } }, required: ["project_id", "query"] } },
  { name: "search_memory", description: "Recupera memoria de largo plazo.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, query: { type: "string" } }, required: ["project_id"] } },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const projectId = String(args.project_id ?? "");
  if (!projectId) throw new Error("project_id es obligatorio");
  switch (name) {
    case "get_project": {
      const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      return p ? { name: p.name, programName: p.programName, objective: p.objective, description: p.description, stack: p.stack, status: p.status } : null;
    }
    case "list_features":
      return db.select().from(projectFeatures).where(eq(projectFeatures.projectId, projectId)).orderBy(asc(projectFeatures.priority));
    case "list_contracts":
      return db.select().from(contracts).where(eq(contracts.projectId, projectId)).orderBy(asc(contracts.order));
    case "list_documents":
      return db.select().from(documents).where(eq(documents.projectId, projectId)).orderBy(desc(documents.createdAt));
    case "list_runs":
      return db.select().from(workflowRuns).where(eq(workflowRuns.projectId, projectId)).orderBy(desc(workflowRuns.createdAt));
    case "get_run_log": {
      const runId = args.run_id ? String(args.run_id) : undefined;
      const [run] = runId
        ? await db
            .select()
            .from(workflowRuns)
            .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.projectId, projectId)))
            .limit(1)
        : await db
            .select()
            .from(workflowRuns)
            .where(eq(workflowRuns.projectId, projectId))
            .orderBy(desc(workflowRuns.createdAt))
            .limit(1);
      if (!run) return { run: null, events: [] };
      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 60)));
      const events = await db
        .select({ seq: runEvents.seq, level: runEvents.level, source: runEvents.source, message: runEvents.message, createdAt: runEvents.createdAt })
        .from(runEvents)
        .where(eq(runEvents.runId, run.id))
        .orderBy(desc(runEvents.seq))
        .limit(limit);
      return {
        run: { id: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt },
        events: events.reverse(),
      };
    }
    case "search_project_docs": {
      const q = String(args.query ?? "").toLowerCase();
      const docs = await db.select().from(documents).where(eq(documents.projectId, projectId));
      return docs
        .filter((d) => d.textExtracted && `${d.title} ${d.textExtracted}`.toLowerCase().includes(q))
        .slice(0, 8)
        .map((d) => ({ title: d.title, snippet: d.textExtracted?.slice(0, 500) }));
    }
    case "search_memory": {
      const q = String(args.query ?? "").toLowerCase();
      const mem = await db.select().from(longTermMemory).where(eq(longTermMemory.projectId, projectId));
      return (q ? mem.filter((m) => m.content.toLowerCase().includes(q)) : mem).slice(0, 10).map((m) => m.content);
    }
    default:
      throw new Error(`Tool desconocida: ${name}`);
  }
}

function send(message: unknown) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

export function handleMessage(msg: JsonRpcRequest): void {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "factoria-project-info", version: "0.1.0" } } });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const name = String((params as { name?: string })?.name ?? "");
    const args = ((params as { arguments?: Record<string, unknown> })?.arguments ?? {}) as Record<string, unknown>;
    callTool(name, args)
      .then((data) => send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } }))
      .catch((error) => send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : error}` }], isError: true } }));
    return;
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Método no soportado: ${method}` } });
}

// Arranque por stdio (sólo si se ejecuta como proceso principal).
if (process.argv[1] && process.argv[1].includes("mcp")) {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      handleMessage(JSON.parse(trimmed) as JsonRpcRequest);
    } catch {
      /* ignorar líneas inválidas */
    }
  });
}
