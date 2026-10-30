import { execFileSync, spawn } from "node:child_process";
import {
  architectureDecisions,
  agentClaims,
  contracts as contractsTable,
  db,
  models,
  policyDecisions,
  projectBudgets,
  projects,
  reviewVerdicts,
  runEvents,
  stepRuns,
  subagents,
  traceSpans,
  usageRecords,
  workflowEdges,
  workflowNodes,
  workflowRuns,
  workflows,
} from "@factoria/db";
import {
  adrPath,
  appendEntry,
  chatJson,
  commitAll,
  createWorktree,
  diffStaged,
  evaluateCondition,
  evaluateClaims,
  fileVerdictStore,
  hashDiff,
  judge as aiJudge,
  mergeWorktree,
  modelFamily,
  nextAdrNumber,
  pushWithAuth,
  renderAdr,
  resolvePermissions,
  reviewDiff,
  stageAll,
  type LedgerEntry,
} from "@factoria/core";
import type { Harness, StepStatus } from "@factoria/shared";
import { resolveExecutor } from "@factoria/executors";
import { asc, eq } from "drizzle-orm";
import { publishRunEvent } from "./events.ts";
import { enqueueRun, type RunJobData } from "./queues.ts";
import { ensureOpencodeServer } from "./opencode-runtime.ts";
import { ensureProjectContainer } from "./container-manager.ts";
import {
  buildContext,
  ensureDir,
  ensureWorkspace,
  gitAuthForProject,
  modelEndpoint,
  ownerModels,
  type ProjectLike,
} from "./workspace.ts";
import { subagentToOpenCodeMarkdown } from "@factoria/core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentRunHandle } from "@factoria/executors";

interface SnapNode {
  key: string;
  type: string;
  name: string;
  description?: string | null;
  modelId?: string | null;
  subagentId?: string | null;
  expectedResult?: string | null;
  harness?: Record<string, unknown> | null;
  workingDir?: string | null;
  joinPolicy?: "all" | "any";
  loopGuard?: { maxIterations: number } | null;
  usesWorkflowId?: string | null;
  dataMapping?: Record<string, string> | null;
  disabled?: boolean | null;
  errorHandling?: { continueOnFail?: boolean } | null;
}

interface SnapEdge {
  fromNodeKey: string;
  toNodeKey: string;
  condition?: { on?: "success" | "failure" } | null;
}

interface GraphSnapshot {
  nodes: SnapNode[];
  edges: SnapEdge[];
}

interface Verdict {
  passed: boolean;
  reasons: string[];
  evidence?: unknown;
}

const MAX_ITERATIONS_DEFAULT = 3;

function gitStatus(dir: string): string {
  try {
    const files = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    const list = execFileSync("ls", ["-la"], { cwd: dir, encoding: "utf8" });
    return `${list}${files}`;
  } catch {
    try {
      return execFileSync("ls", ["-la"], { cwd: dir, encoding: "utf8" });
    } catch {
      return "(workspace no disponible)";
    }
  }
}

async function runCapture(command: string, cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (c: Buffer) => (output += c.toString()));
    child.stderr.on("data", (c: Buffer) => (output += c.toString()));
    child.on("error", (e) => resolve({ code: 127, output: e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, output: output.slice(0, 400) }));
  });
}

function rawModelId(modelId: string): string {
  return modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;
}

/** Un modelo es apto para ejecutar agentes si puede razonar y usar herramientas. */
function isAgentCapable(capabilities: unknown): boolean {
  const caps = Array.isArray(capabilities) ? capabilities.map((c) => String(c)) : [];
  return caps.includes("code") || caps.includes("toolUse");
}

type ResolvedModel = {
  endpoint: NonNullable<Awaited<ReturnType<typeof modelEndpoint>>>;
  modelRef: { providerID: string; modelID: string };
  modelId: string;
};

/**
 * Elige un modelo de ejecución real: el del nodo, el del harness del proyecto,
 * el del asistente o el primer modelo habilitado con capacidad de código.
 * Nunca deja que opencode use su modelo por defecto (p. ej. un modelo de audio).
 */
async function resolveAgentModel(
  project: { ownerId: string; assistantModelId: string | null; defaultHarness?: unknown },
  node: { modelId?: string | null },
): Promise<ResolvedModel | null> {
  const candidates: string[] = [];
  if (node.modelId) candidates.push(node.modelId);
  const harnessModel = (project.defaultHarness as { modelId?: unknown } | null | undefined)?.modelId;
  if (typeof harnessModel === "string" && harnessModel) candidates.push(harnessModel);
  if (project.assistantModelId) candidates.push(project.assistantModelId);

  const seen = new Set<string>();
  const tryId = async (id: string): Promise<ResolvedModel | null> => {
    if (seen.has(id)) return null;
    seen.add(id);
    const [row] = await db.select({ capabilities: models.capabilities }).from(models).where(eq(models.id, id)).limit(1);
    if (!row || !isAgentCapable(row.capabilities)) return null;
    const endpoint = await modelEndpoint(project.ownerId, id);
    if (!endpoint) return null;
    return {
      endpoint,
      modelId: endpoint.modelId,
      modelRef: { providerID: endpoint.providerId, modelID: rawModelId(endpoint.modelId) },
    };
  };

  for (const id of candidates) {
    const resolved = await tryId(id);
    if (resolved) return resolved;
  }
  for (const candidate of await ownerModels(project.ownerId)) {
    if (!isAgentCapable(candidate.capabilities)) continue;
    const resolved = await tryId(candidate.id);
    if (resolved) return resolved;
  }
  return null;
}


export async function processRun(job: RunJobData): Promise<void> {
  const { runId, projectId } = job;

  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!run || !project) {
    console.error(`[worker] run ${runId} o proyecto ${projectId} no encontrados`);
    return;
  }
  if (run.status === "cancelled") return;
  // Garantiza que el runtime de agentes esté disponible antes de ejecutar.
  await ensureOpencodeServer();
  // Desarrollo en contenedor: se arranca (best-effort) el contenedor del proyecto.
  try {
    const info = await ensureProjectContainer(projectId);
    if (info) console.log(`[worker] contenedor del proyecto ${projectId}: ${info.status}`);
  } catch (error) {
    console.warn(`[worker] no se pudo arrancar el contenedor del proyecto: ${error instanceof Error ? error.message : error}`);
  }

  const graph = run.graphSnapshot as GraphSnapshot;
  const workspaceDir = ensureWorkspace(project as unknown as ProjectLike);

  // Variables del flujo para sustitución en prompts ({{ clave }}).
  const [wfRow] = project.workflowId
    ? await db.select({ variables: workflows.variables }).from(workflows).where(eq(workflows.id, project.workflowId)).limit(1)
    : [];
  const flowVariables = (wfRow?.variables ?? {}) as Record<string, string>;
  const outputsByNode = new Map<string, string>();
  const resolveExpr = (expr: string): string => {
    const parts = expr.trim().split(".");
    if (parts[0] === "vars") return String(flowVariables[parts.slice(1).join(".")] ?? "");
    if (parts[0] === "project") {
      const k = parts.slice(1).join(".");
      const p = project as unknown as Record<string, unknown>;
      return Array.isArray(p[k]) ? (p[k] as string[]).join(", ") : String(p[k] ?? "");
    }
    if (parts[0] === "nodes") {
      const key = parts[1] ?? "";
      const field = parts[2] ?? "output";
      if (field === "verdict") return JSON.stringify(verdicts.get(key) ?? {});
      return String(outputsByNode.get(key) ?? "").slice(0, 8000);
    }
    return "";
  };
  const substitute = (text: string): string =>
    text.replace(/\{\{\s*([\w.\- ]+)\s*\}\}/g, (_m, expr: string) => resolveExpr(expr));

  // Reconstruir estado a partir de los StepRun existentes (reanudación).
  const existingSteps = await db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).orderBy(asc(stepRuns.startedAt));
  const rawEvents = await db
    .select({ seq: runEvents.seq, id: runEvents.id })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq));
  let seq = rawEvents.length ? rawEvents[rawEvents.length - 1]!.seq : 0;

  const emit = async (
    stepRunId: string | null,
    source: string,
    message: string,
    level = "info",
    payload?: Record<string, unknown>,
  ) => {
    seq += 1;
    const createdAt = new Date().toISOString();
    await db.insert(runEvents).values({
      runId,
      stepRunId: stepRunId ?? undefined,
      seq,
      level: level as never,
      source: source as never,
      message,
      payload,
    });
    await publishRunEvent(runId, { seq, level, source, message, stepRunId, payload, createdAt });
  };

  const status = new Map<string, StepStatus>();
  const feedback = new Map<string, string[]>();
  const verdicts = new Map<string, Verdict>();
  const iterations = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.type === "start") status.set(node.key, "succeeded");
    else if (node.type === "note" || (node as { disabled?: boolean }).disabled === true) status.set(node.key, "skipped");
    else status.set(node.key, "pending");
  }
  for (const s of existingSteps) {
    if (!s.nodeKey) continue;
    status.set(s.nodeKey, s.status);
    iterations.set(s.nodeKey, s.iteration);
    if (s.verdict) verdicts.set(s.nodeKey, s.verdict as unknown as Verdict);
  }

  await db.update(workflowRuns).set({ status: "running", startedAt: run.startedAt ?? new Date(), currentNodes: [] }).where(eq(workflowRuns.id, runId));
  if (existingSteps.length === 0) {
    await emit(null, "orchestrator", `Run iniciado (${graph.nodes.length} nodos, ${graph.edges.length} aristas)`);
  } else {
    await emit(null, "orchestrator", "Run reanudado");
  }

  const entry = { handles: new Set<AgentRunHandle>(), pause: false };
  active.set(runId, entry);
  const [rootSpan] = await db
    .insert(traceSpans)
    .values({ runId, kind: "run", name: project.name, attributes: {} as never, startedAt: new Date() })
    .returning();
  const rootSpanId = rootSpan?.id;

  const edgeId = (e: SnapEdge) => `${e.fromNodeKey}->${e.toNodeKey}`;
  const predecessors = (key: string) => graph.edges.filter((e) => e.toNodeKey === key);

  const backEdges = new Set<string>();
  {
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const dfs = (key: string) => {
      visited.add(key);
      onStack.add(key);
      for (const edge of graph.edges.filter((e) => e.fromNodeKey === key)) {
        const to = edge.toNodeKey;
        if (onStack.has(to)) backEdges.add(edgeId(edge));
        else if (!visited.has(to)) dfs(to);
      }
      onStack.delete(key);
    };
    for (const node of graph.nodes) if (!visited.has(node.key)) dfs(node.key);
  }
  const forwardEdges = (key: string) => graph.edges.filter((e) => e.fromNodeKey === key && !backEdges.has(edgeId(e)));

  const forwardReach = (key: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const stack = [key];
    while (stack.length) {
      const k = stack.pop()!;
      for (const edge of forwardEdges(k)) {
        if (!seen.has(edge.toNodeKey)) {
          seen.add(edge.toNodeKey);
          out.push(edge.toNodeKey);
          stack.push(edge.toNodeKey);
        }
      }
    }
    return out;
  };
  const resetDownstream = (key: string) => {
    for (const k of [key, ...forwardReach(key)]) {
      if (k === "start" || k === "end") continue;
      status.set(k, "pending");
      verdicts.delete(k);
    }
  };

  const edgeActive = (edge: SnapEdge): boolean => {
    const src = status.get(edge.fromNodeKey);
    if (src !== "succeeded" && src !== "failed") return false;
    const on = edge.condition?.on;
    if (!on) return src === "succeeded";
    return (on === "success" && src === "succeeded") || (on === "failure" && src === "failed");
  };
  const edgeDecided = (edge: SnapEdge): boolean => {
    const src = status.get(edge.fromNodeKey);
    return src === "succeeded" || src === "failed" || src === "skipped";
  };

  const computeReady = (): string[] => {
    const ready: string[] = [];
    for (const node of graph.nodes) {
      if (node.type === "start" || node.type === "end") continue;
      const current = status.get(node.key);
      if (current && current !== "pending" && current !== "ready") continue;
      const incoming = predecessors(node.key);
      const forward = incoming.filter((e) => !backEdges.has(edgeId(e)));
      const forwardOk =
        forward.length === 0 ? true : (node.joinPolicy ?? "all") === "all" ? forward.every(edgeDecided) : forward.some(edgeDecided);
      const anyActive = incoming.length === 0 ? true : incoming.some(edgeActive);
      if (forwardOk && anyActive) ready.push(node.key);
    }
    return ready;
  };

  const finalizeStep = async (stepRunId: string | null, st: StepStatus, verdict: Verdict) => {
    if (!stepRunId) return;
    await db
      .update(stepRuns)
      .set({ status: st, verdict: verdict as unknown as Record<string, unknown>, finishedAt: new Date() })
      .where(eq(stepRuns.id, stepRunId));
  };

  // Devuelve "pause" si el nodo queda a la espera de aprobación humana.
  const executeNode = async (node: SnapNode): Promise<"ok" | "pause"> => {
    const iteration = (iterations.get(node.key) ?? 0) + 1;
    iterations.set(node.key, iteration);
    status.set(node.key, "running");

    const harness = (node.harness ?? project.defaultHarness ?? {}) as Harness;
    const subagent = node.subagentId
      ? (await db.select().from(subagents).where(eq(subagents.id, node.subagentId)).limit(1))[0]
      : undefined;
    if (subagent && (harness.executor ?? "opencode") === "opencode") {
      const agentDir = path.join(workspaceDir, ".opencode", "agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        path.join(agentDir, `${subagent.name}.md`),
        subagentToOpenCodeMarkdown({
          name: subagent.name,
          description: subagent.description,
          instructions: subagent.instructions,
          category: subagent.category,
          defaultModelId: subagent.defaultModelId,
          temperature: subagent.temperature,
          permissions: subagent.permissions as never,
          outputContract: subagent.outputContract,
          mcpServers: subagent.mcpServers,
          skills: subagent.skills,
        }),
      );
    }

    const [step] = await db
      .insert(stepRuns)
      .values({
        runId,
        nodeKey: node.key,
        iteration,
        status: "running",
        subagentId: node.subagentId ?? undefined,
        modelId: node.modelId ?? undefined,
        executor: harness.executor ?? "opencode",
        startedAt: new Date(),
      })
      .returning();
    const stepRunId = step?.id ?? null;

    await emit(stepRunId, "orchestrator", `Paso «${node.name}» iniciado (iteración ${iteration})`, "info", { nodeKey: node.key, type: node.type });

    const [stepSpan] = await db
      .insert(traceSpans)
      .values({
        runId,
        stepRunId: stepRunId ?? undefined,
        parentId: rootSpanId ?? undefined,
        kind: "step",
        name: node.name,
        attributes: { nodeKey: node.key, type: node.type, iteration } as never,
        startedAt: new Date(),
      })
      .returning();
    const stepSpanId = stepSpan?.id ?? null;

    // --- Aprobación humana ---
    if (node.type === "human_approval") {
      await db.update(stepRuns).set({ status: "waiting_approval" }).where(eq(stepRuns.id, stepRunId!));
      await db.update(workflowRuns).set({ status: "paused", currentNodes: [node.key] }).where(eq(workflowRuns.id, runId));
      await emit(stepRunId, "orchestrator", `Paso «${node.name}» espera aprobación humana`, "warn", { nodeKey: node.key });
      status.set(node.key, "waiting_approval");
      return "pause";
    }

    // --- Verificación de contratos ---
    if (node.type === "contract_check") {
      const ok = await evaluateContracts(project, workspaceDir);
      const verdict: Verdict = { passed: ok, reasons: [ok ? "Contratos satisfechos" : "Contratos pendientes/fallidos"] };
      verdicts.set(node.key, verdict);
      status.set(node.key, ok ? "succeeded" : "failed");
      await finalizeStep(stepRunId, ok ? "succeeded" : "failed", verdict);
      await emit(stepRunId, "orchestrator", `Contratos: ${ok ? "satisfechos" : "pendientes"}`, ok ? "info" : "warn", { nodeKey: node.key });
      return "ok";
    }

    // --- Condición / router ---
    if (node.type === "condition") {
      const cfg = (harness as unknown as { condition?: Record<string, unknown> }).condition ?? {};
      const text = Object.values(verdicts).map((v) => v.reasons.join(" ")).join("\n");
      let passed = evaluateCondition(cfg as never, { text, outputs: {} });
      let reason = "condición determinista";
      if (passed === undefined && node.modelId) {
        const ep = await modelEndpoint(project.ownerId, node.modelId);
        if (ep) {
          try {
            const r = await chatJson<{ result: boolean; reason?: string }>({
              provider: ep.provider,
              modelId: ep.modelId,
              system: "Evalúas condiciones. Devuelves JSON.",
              prompt: `${node.description ?? ""}\nContexto:\n${text.slice(0, 3000)}\nJSON: {"result": boolean, "reason": "..."}`,
              json: true,
            });
            passed = Boolean(r.result);
            reason = r.reason ?? "router IA";
          } catch { passed = true; }
        }
      }
      const verdict: Verdict = { passed: passed ?? true, reasons: [reason] };
      verdicts.set(node.key, verdict);
      status.set(node.key, verdict.passed ? "succeeded" : "failed");
      await finalizeStep(stepRunId, verdict.passed ? "succeeded" : "failed", verdict);
      await emit(stepRunId, "orchestrator", `Condición «${node.name}»: ${verdict.passed ? "sí" : "no"}`, "info", { nodeKey: node.key });
      return "ok";
    }

    // --- Sub-workflow ---
    if (node.type === "subworkflow" && node.usesWorkflowId) {
      try {
        const childNodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, node.usesWorkflowId));
        const childEdges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, node.usesWorkflowId));
        const snapshot = {
          nodes: childNodes.map((n) => ({
            key: n.key, type: n.type, name: n.name, description: n.description, modelId: n.modelId, subagentId: n.subagentId,
            expectedResult: n.expectedResult, harness: n.harness, workingDir: n.workingDir, joinPolicy: n.joinPolicy,
            loopGuard: n.loopGuard, usesWorkflowId: n.usesWorkflowId,
          })),
          edges: childEdges.map((e) => ({ fromNodeKey: e.fromNodeKey, toNodeKey: e.toNodeKey, condition: e.condition })),
        };
        const [childRun] = await db
          .insert(workflowRuns)
          .values({ projectId, workflowId: node.usesWorkflowId, graphSnapshot: snapshot as never, status: "queued", triggeredBy: project.ownerId })
          .returning();
        if (childRun) await enqueueRun(childRun.id, projectId);
        await emit(stepRunId, "orchestrator", `Subflujo «${node.name}» lanzado (run ${childRun?.id ?? "?"})`, "info", { nodeKey: node.key, childRunId: childRun?.id });
        const verdict: Verdict = { passed: true, reasons: ["Subflujo encolado"] };
        verdicts.set(node.key, verdict);
        status.set(node.key, "succeeded");
        await finalizeStep(stepRunId, "succeeded", verdict);
      } catch (error) {
        const verdict: Verdict = { passed: false, reasons: [`Error lanzando subflujo: ${error instanceof Error ? error.message : error}`] };
        verdicts.set(node.key, verdict);
        status.set(node.key, "failed");
        await finalizeStep(stepRunId, "failed", verdict);
      }
      return "ok";
    }

    // --- Push a repositorio ---
    if (node.type === "push_repo") {
      let passed = true;
      const reasons: string[] = [];
      if (project.repoUrl) {
        const commit = commitAll(workspaceDir, `Factoría: ${node.name}`);
        const auth = gitAuthForProject(project as unknown as ProjectLike);
        const push = pushWithAuth(workspaceDir, project.repoBranch ?? "HEAD", auth);
        passed = push.ok;
        reasons.push(commit.ok ? "commit creado" : "sin cambios", push.ok ? "push realizado" : `push falló: ${push.output.slice(0, 120)}`);
      } else {
        reasons.push("El proyecto no tiene repositorio configurado");
      }
      const verdict: Verdict = { passed, reasons };
      verdicts.set(node.key, verdict);
      status.set(node.key, passed ? "succeeded" : "failed");
      await finalizeStep(stepRunId, passed ? "succeeded" : "failed", verdict);
      await emit(stepRunId, "orchestrator", `Push «${node.name}»: ${reasons.join("; ")}`, passed ? "info" : "warn", { nodeKey: node.key });
      return "ok";
    }

    // --- Notificación ---
    if (node.type === "notify") {
      await emit(stepRunId, "orchestrator", `Notificación: ${node.description ?? node.name}`, "info", { nodeKey: node.key });
      const verdict: Verdict = { passed: true, reasons: ["Notificado"] };
      verdicts.set(node.key, verdict);
      status.set(node.key, "succeeded");
      await finalizeStep(stepRunId, "succeeded", verdict);
      return "ok";
    }

    // --- Review gate cross-AI (revisor de familia distinta al autor) ---
    if (node.type === "review_gate") {
      const diffDir = node.workingDir && node.workingDir !== "." ? path.join(workspaceDir, node.workingDir) : workspaceDir;
      stageAll(diffDir);
      const diff = diffStaged(diffDir);
      const expected = node.expectedResult ?? undefined;
      // Autor = modelo del predecesor con modelo definido (el paso que produjo el diff).
      const predModelId = graph.edges
        .filter((e) => e.toNodeKey === node.key)
        .map((e) => graph.nodes.find((n) => n.key === e.fromNodeKey)?.modelId)
        .find(Boolean);
      const authorRef = predModelId ? await modelEndpoint(project.ownerId, predModelId) : null;
      const authorModelId = authorRef?.modelId ?? null;
      const authorFamily = authorModelId ? modelFamily(authorModelId) : null;
      const candidates = (await ownerModels(project.ownerId)).filter((c) => isAgentCapable(c.capabilities));
      const isPremium = (id: string) => /premium/i.test(id);
      const ordered = [
        ...candidates.filter((c) => (!authorFamily || modelFamily(c.modelId) !== authorFamily) && !isPremium(c.modelId)),
        ...candidates.filter((c) => (!authorFamily || modelFamily(c.modelId) !== authorFamily) && isPremium(c.modelId)),
        ...candidates.filter((c) => authorFamily && modelFamily(c.modelId) === authorFamily),
      ];

      let verdict: Verdict = { passed: true, reasons: ["Sin cambios que revisar"] };
      if (diff.trim()) {
        const projContracts = await db
          .select({ criterion: contractsTable.criterion })
          .from(contractsTable)
          .where(eq(contractsTable.projectId, projectId));
        const hash = hashDiff(diff);
        let done = false;
        for (const cand of ordered) {
          const ep = await modelEndpoint(project.ownerId, cand.id);
          if (!ep) continue;
          await emit(stepRunId, "orchestrator", `Revisión cross-AI con ${ep.modelId} (autor: ${authorModelId ?? "n/d"})…`, "info", { nodeKey: node.key });
          const result = await reviewDiff(ep.provider, ep.modelId, {
            diff,
            expectedResult: expected,
            contracts: projContracts.map((c) => c.criterion),
            authorModel: authorModelId ?? undefined,
          });
          if (result.summary.startsWith("Revisor no disponible")) continue; // prueba el siguiente modelo
          await db
            .insert(reviewVerdicts)
            .values({
              runId,
              stepRunId: stepRunId ?? undefined,
              projectId,
              diffHash: hash,
              verdict: result.verdict,
              reviewerModelId: ep.modelId,
              reviewerFamily: cand.modelId,
              authorModelId: authorModelId ?? undefined,
              summary: result.summary,
              confidence: result.confidence.toString(),
            })
            .onConflictDoNothing();
          await fileVerdictStore(workspaceDir).save({
            verdict: result.verdict,
            diffHash: hash,
            reviewerModelId: ep.modelId,
            authorModelId: authorModelId ?? undefined,
            summary: result.summary,
            confidence: result.confidence,
            workspace: "root",
          });
          await recordLedger(projectId, runId, stepRunId, {
            gate: "review",
            outcome: result.verdict === "approved" ? "allow" : "deny",
            reason: result.summary,
            ruleId: `review:${hash.slice(0, 12)}`,
          });
          verdict = { passed: result.verdict === "approved", reasons: [result.summary, ...result.findings] };
          done = true;
          break;
        }
        if (!done) verdict = { passed: false, reasons: ["Ningún modelo revisor disponible con familia distinta (fail-closed)"] };
      }
      verdicts.set(node.key, verdict);
      status.set(node.key, verdict.passed ? "succeeded" : "failed");
      await finalizeStep(stepRunId, verdict.passed ? "succeeded" : "failed", verdict);
      await emit(stepRunId, "orchestrator", `Review gate «${node.name}»: ${verdict.passed ? "aprobado" : "rechazado"} — ${verdict.reasons.join("; ")}`, verdict.passed ? "info" : "warn", { nodeKey: node.key });
      return "ok";
    }

    // --- ADR (Architecture Decision Record, git-tracked) ---
    if (node.type === "adr") {
      const existing = await db
        .select({ number: architectureDecisions.number })
        .from(architectureDecisions)
        .where(eq(architectureDecisions.projectId, projectId));
      const number = nextAdrNumber(existing);
      const title = node.name;
      const decision = node.description ?? node.expectedResult ?? `Decisión registrada por el paso «${node.name}».`;
      const context = node.expectedResult ?? "";
      const rel = adrPath(number, title);
      const abs = path.join(workspaceDir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, renderAdr({ number, title, status: "proposed", context, decision, consequences: "" }));
      await db.insert(architectureDecisions).values({ projectId, number, title, status: "proposed", context, decision, consequences: "", gitPath: rel });
      const verdict: Verdict = { passed: true, reasons: [`ADR ${number} registrado en ${rel}`] };
      verdicts.set(node.key, verdict);
      status.set(node.key, "succeeded");
      await finalizeStep(stepRunId, "succeeded", verdict);
      await emit(stepRunId, "orchestrator", `ADR ${number}: ${title} (${rel})`, "info", { nodeKey: node.key });
      return "ok";
    }

    // --- Ejecución con agente ---
    const permissions = resolvePermissions((subagent?.permissions as never) ?? undefined, (harness.permissions as never) ?? undefined);
    const executor = resolveExecutor(harness.executor ?? "opencode");

    let model = node.modelId ? await modelEndpoint(project.ownerId, node.modelId) : null;
    let modelRef: { providerID: string; modelID: string } | undefined = model
      ? { providerID: model.providerId, modelID: rawModelId(model.modelId) }
      : undefined;
    if (executor.name !== "mock") {
      const resolved = await resolveAgentModel(
        project as unknown as { ownerId: string; assistantModelId: string | null; defaultHarness?: unknown },
        node,
      );
      if (!resolved) {
        const verdict: Verdict = {
          passed: false,
          reasons: ["No hay ningún modelo de ejecución apto. Asigna al nodo o al proyecto un modelo habilitado con capacidad de código/toolUse."],
        };
        verdicts.set(node.key, verdict);
        status.set(node.key, "failed");
        await emit(stepRunId, "orchestrator", `Paso fallido: «${node.name}» — sin modelo de ejecución apto`, "error", { nodeKey: node.key });
        await finalizeStep(stepRunId, "failed", verdict);
        return "ok";
      }
      model = resolved.endpoint;
      modelRef = resolved.modelRef;
      await emit(stepRunId, "orchestrator", `Modelo de ejecución: ${resolved.modelId}`, "debug", { nodeKey: node.key, model: resolved.modelId });
    }

    let nodeWorkdir = ensureDir(workspaceDir, node.workingDir ?? ".");
    let worktreeBranch: string | undefined;
    const rules = (harness.rules ?? {}) as { worktree?: boolean };
    if (rules.worktree && node.workingDir && node.workingDir !== ".") {
      const wtPath = `${workspaceDir}/.worktrees/${node.key}-${iteration}`;
      worktreeBranch = `wt/${node.key}-${iteration}`;
      const r = createWorktree(workspaceDir, wtPath, worktreeBranch);
      if (r.ok) nodeWorkdir = wtPath;
    }

    const context = await buildContext(
      project as unknown as ProjectLike,
      project.ownerId,
      `${node.name}. ${node.description ?? ""} ${node.expectedResult ?? ""}`,
      ((harness.rag as { topK?: number } | undefined)?.topK) ?? 5,
    );
    const priorFeedback = (iterations.get(node.key) ?? 0) > 1 ? feedback.get(node.key) : undefined;
    const prompt = [
      subagent?.instructions ? `# Rol\n${subagent.instructions}\n` : "",
      `# Proyecto\n${project.name} — ${project.objective}`,
      project.stack && project.stack.length ? `Stack: ${project.stack.join(", ")}` : "",
      context ? `# Contexto del proyecto\n${context}` : "",
      `# Tarea: ${node.name}`,
      node.description ?? "",
      node.expectedResult ? `# Resultado esperado\n${node.expectedResult}` : "",
      priorFeedback?.length ? `# Correcciones obligatorias de la revisión anterior (iteración ${(iterations.get(node.key) ?? 1) - 1})\n- ${priorFeedback.join("\n- ")}` : "",
      node.dataMapping && Object.keys(node.dataMapping).length
        ? `# Datos de entrada\n${Object.entries(node.dataMapping).map(([k, expr]) => `- ${k}: ${substitute(String(expr))}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const finalPrompt = substitute(prompt);
    const startedAt = Date.now();

    const slotKey = modelRef?.providerID ?? "mock";
    await acquireSlot(slotKey);

    let transcript = "";
    let toolEventCount = 0;
    const handle = await executor.run({
      runId,
      stepRunId: stepRunId ?? node.key,
      workspaceDir: nodeWorkdir,
      prompt: finalPrompt,
      model: modelRef,
      harness: { executor: harness.executor ?? "opencode", permissions, mcpServers: (harness.mcpServers as string[] | undefined) ?? [], skills: (harness.skills as string[] | undefined) ?? [], gates: (harness.gates as Harness["gates"] | undefined) ?? [], agentProfile: "build" },
      subagentInstructions: subagent?.instructions ?? undefined,
      onEvent: async (event) => {
        if (event.type === "text") {
          const text = event.message ?? (typeof event.payload === "string" ? event.payload : "");
          if (text) {
            transcript += `${text}\n`;
            await emit(stepRunId, "agent", String(text), "info", { nodeKey: node.key, kind: "text" });
          }
        } else if (event.type === "reasoning") {
          const text = event.message ?? "";
          if (text) await emit(stepRunId, "agent", String(text), "debug", { nodeKey: node.key, kind: "reasoning" });
        } else if (event.type === "tool") {
          toolEventCount += 1;
          const payload = (event.payload ?? {}) as Record<string, unknown>;
          await emit(stepRunId, "tool", event.message ?? "herramienta", "info", { nodeKey: node.key, kind: "tool", ...payload });
        } else if (event.type === "log") {
          if (event.message) await emit(stepRunId, "agent", String(event.message), "debug", { nodeKey: node.key, kind: "log" });
        } else if (event.type === "error") {
          await emit(stepRunId, "agent", `Error del modelo: ${event.message ?? "desconocido"}`, "error", { nodeKey: node.key, kind: "error" });
        } else if (event.type === "usage" && event.payload) {
          const u = event.payload as { inputTokens?: number; outputTokens?: number; cost?: number };
          await emit(stepRunId, "agent", `uso: ${u.inputTokens ?? 0} in / ${u.outputTokens ?? 0} out`, "debug", { nodeKey: node.key, kind: "usage", ...u });
        } else if (event.type === "done") {
          await emit(stepRunId, "agent", "El agente terminó su trabajo", "info", { nodeKey: node.key });
        }
      },
    });

    entry.handles.add(handle);
    void handle.result.catch(() => {}).finally(() => entry.handles.delete(handle));
    let result: import("@factoria/executors").AgentRunResult;
    try {
      result = await handle.result;
    } finally {
      releaseSlot(slotKey);
    }

    if (stepSpanId) {
      await db
        .update(traceSpans)
        .set({
          endedAt: new Date(),
          attributes: { nodeKey: node.key, type: node.type, executor: executor.name, iteration, model: model?.modelId ?? null } as never,
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          cost: (result.usage?.cost ?? 0).toString(),
        })
        .where(eq(traceSpans.id, stepSpanId));
    }

    // Evidencia real del workspace (el agente puede escribir mucho y resumir poco).
    const evidence = gitStatus(nodeWorkdir);
    const outputWithEvidence = `${result.output}\n\n[Evidencia del workspace]\n${evidence}`;

    // Verificación híbrida: comando determinista Y/O juez IA.
    let verdict: Verdict = {
      passed: result.status === "succeeded",
      reasons: [result.status === "succeeded" ? "succeeded" : `failed${result.error ? `: ${result.error}` : ""}`],
    };
    let cmdVerdict: Verdict | undefined;
    let judged: Verdict | undefined;
    if (harness.validationCommand && result.status === "succeeded") {
      const [cmdSpan] = await db
        .insert(traceSpans)
        .values({ runId, stepRunId: stepRunId ?? undefined, parentId: stepSpanId ?? undefined, kind: "command", name: harness.validationCommand.slice(0, 120), startedAt: new Date() })
        .returning();
      const r = await runCapture(harness.validationCommand, nodeWorkdir);
      if (cmdSpan) await db.update(traceSpans).set({ endedAt: new Date(), attributes: { exitCode: r.code, output: r.output } as never }).where(eq(traceSpans.id, cmdSpan.id));
      cmdVerdict = {
        passed: r.code === 0,
        reasons: r.code === 0 ? ["validationCommand OK"] : [`validationCommand falló (código ${r.code})${r.output ? `: ${r.output.trim().slice(0, 300)}` : ""}`],
      };
    }
    if (result.status === "succeeded" && model && (node.type === "gate" || node.expectedResult)) {
      await emit(stepRunId, "orchestrator", "Evaluando con juez IA…", "info", { nodeKey: node.key });
      const projContracts = await db.select({ criterion: contractsTable.criterion }).from(contractsTable).where(eq(contractsTable.projectId, projectId));
      const [judgeSpan] = await db
        .insert(traceSpans)
        .values({ runId, stepRunId: stepRunId ?? undefined, parentId: stepSpanId ?? undefined, kind: "judge", name: model.modelId, startedAt: new Date() })
        .returning();
      judged = await aiJudge(model.provider, model.modelId, {
        expectedResult: node.expectedResult ?? undefined,
        output: outputWithEvidence,
        contracts: projContracts.map((c) => c.criterion),
      }, async (e) => { if (e.type === "text" && e.message) await emit(stepRunId, "agent", `juez: ${e.message}`, "info", { nodeKey: node.key }); });
      if (judgeSpan) await db.update(traceSpans).set({ endedAt: new Date(), attributes: { passed: judged.passed } as never }).where(eq(traceSpans.id, judgeSpan.id));
    }
    if (cmdVerdict && judged) {
      verdict = { passed: cmdVerdict.passed && judged.passed, reasons: [...judged.reasons, ...cmdVerdict.reasons] };
    } else if (cmdVerdict) {
      verdict = cmdVerdict;
    } else if (judged) {
      verdict = judged;
    }

    // Un "éxito" sin respuesta, sin herramientas y sin verificación es sospechoso:
    // evita marcar como completado un paso que en realidad no hizo nada.
    if (
      result.status === "succeeded" &&
      verdict.passed &&
      !result.output.trim() &&
      !transcript.trim() &&
      toolEventCount === 0 &&
      !cmdVerdict &&
      !judged
    ) {
      verdict = { passed: false, reasons: ["El agente no produjo ninguna respuesta ni acción en el workspace"] };
    }

    // Claims: afirmaciones duras del agente contrastadas con el transcript real.
    if (result.status === "succeeded" && verdict.passed) {
      const claimsVerdict = evaluateClaims(result.output, `${transcript}\n${evidence}`);
      if (claimsVerdict.claims.length) {
        await db.insert(agentClaims).values(
          claimsVerdict.claims.map((c) => ({
            runId,
            stepRunId: stepRunId ?? undefined,
            projectId,
            text: c.text,
            status: c.status,
            evidence: c.evidence as Record<string, unknown> | undefined,
          })),
        );
      }
      if (!claimsVerdict.passed) {
        verdict = { passed: false, reasons: [...verdict.reasons, ...claimsVerdict.reasons] };
        await recordLedger(projectId, runId, stepRunId, {
          gate: "claims",
          outcome: "deny",
          reason: claimsVerdict.reasons.join("; "),
        });
        await emit(stepRunId, "orchestrator", `Afirmaciones desmentidas en «${node.name}»: ${claimsVerdict.reasons.join("; ")}`, "warn", { nodeKey: node.key });
      }
    }

    if (result.usage) {
      await db.insert(usageRecords).values({
        runId,
        stepRunId: stepRunId ?? undefined,
        projectId,
        modelId: node.modelId ?? undefined,
        subagentId: node.subagentId ?? undefined,
        kind: "chat",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cost: (result.usage.cost ?? 0).toString(),
      });
    }

    if (worktreeBranch && verdict.passed) {
      mergeWorktree(workspaceDir, worktreeBranch, `Integrar ${node.key}`);
    }

    verdicts.set(node.key, verdict);
    outputsByNode.set(node.key, `${result.output}\n${gitStatus(nodeWorkdir)}`.slice(0, 12000));

    // continueOnFail: el fallo no bloquea el flujo.
    let finalStatus: StepStatus = verdict.passed ? "succeeded" : "failed";
    if (!verdict.passed && node.errorHandling?.continueOnFail) {
      finalStatus = "succeeded";
      status.set(node.key, "succeeded");
      await emit(stepRunId, "orchestrator", `«${node.name}» falló pero continúa (continue-on-fail)`, "warn", { nodeKey: node.key });
    } else {
      status.set(node.key, verdict.passed ? "succeeded" : "failed");
    }

    await emit(stepRunId, "orchestrator", `${verdict.passed ? "Paso completado" : "Paso fallido"}: «${node.name}» — ${verdict.reasons.join("; ")}`, verdict.passed ? "info" : "warn", { nodeKey: node.key, ms: Date.now() - startedAt });
    await finalizeStep(stepRunId, finalStatus, verdict);
    return "ok";
  };

  // --- Bucle principal ---
  let guard = 0;
  const maxTicks = 500;
  let paused = false;
  while (guard++ < maxTicks) {
    const [current] = await db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (entry.pause) {
      await db.update(workflowRuns).set({ status: "paused" }).where(eq(workflowRuns.id, runId));
      await emit(null, "orchestrator", "Run en pausa (solicitado)", "warn");
      paused = true;
      break;
    }
    if (current?.status === "cancelled") {
      await emit(null, "orchestrator", "Run cancelado", "warn");
      return;
    }
    const ready = computeReady();
    if (ready.length === 0) break;
    await db.update(workflowRuns).set({ currentNodes: ready }).where(eq(workflowRuns.id, runId));

    const results = await Promise.all(
      ready.map(async (key) => {
        const node = graph.nodes.find((n) => n.key === key)!;
        return executeNode(node);
      }),
    );
    if (results.includes("pause")) {
      paused = true;
      break;
    }

    if (await checkBudget(project, runId, emit)) {
      paused = true;
      break;
    }

    for (const key of ready) {
      for (const edge of graph.edges.filter((e) => e.fromNodeKey === key && backEdges.has(edgeId(e)))) {
        const target = edge.toNodeKey;
        const maxIter = graph.nodes.find((n) => n.key === target)?.loopGuard?.maxIterations ?? MAX_ITERATIONS_DEFAULT;
        const it = iterations.get(target) ?? 0;
        if (edgeActive(edge) && it < maxIter) {
          const reasons = verdicts.get(key)?.reasons ?? [];
          if (reasons.length) feedback.set(target, [...reasons, ...(feedback.get(target) ?? [])].slice(0, 12));
          await emit(null, "orchestrator", `Reintentando «${target}» (bucle, iteración ${it + 1})`, "info", { nodeKey: target });
          resetDownstream(target);
        }
      }
    }
  }

  if (paused) {
    active.delete(runId);
    return;
  }

  for (const end of graph.nodes.filter((n) => n.type === "end")) status.set(end.key, "succeeded");

  const isTest = run.kind === "test";
  const allContractsOk = isTest ? true : await evaluateContracts(project, workspaceDir);
  const anyFailed = [...status.values()].some((s) => s === "failed");
  const runStatus = anyFailed ? "failed" : "succeeded";
  await db.update(workflowRuns).set({ status: runStatus, finishedAt: new Date(), currentNodes: [] }).where(eq(workflowRuns.id, runId));
  if (!isTest) {
    await db
      .update(projects)
      .set({ status: !anyFailed && allContractsOk ? "completed" : anyFailed ? "paused" : project.status, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }
  await emit(null, "orchestrator", isTest ? "Run de prueba finalizado" : `Run finalizado: ${runStatus}. Contratos: ${allContractsOk ? "todos satisfechos" : "pendientes"}`, anyFailed ? "warn" : "info");
  if (rootSpanId) await db.update(traceSpans).set({ endedAt: new Date() }).where(eq(traceSpans.id, rootSpanId));
  active.delete(runId);
}

const active = new Map<string, { handles: Set<AgentRunHandle>; pause: boolean }>();

// Límite de concurrencia por proveedor (protege frente a rate limits).
const providerSlots = new Map<string, { active: number; waiters: (() => void)[] }>();

async function acquireSlot(key: string): Promise<void> {
  const limit = Number(process.env.MAX_CONCURRENT_PER_PROVIDER ?? 3);
  const e = providerSlots.get(key) ?? { active: 0, waiters: [] };
  providerSlots.set(key, e);
  if (e.active < limit) {
    e.active += 1;
    return;
  }
  await new Promise<void>((resolve) => e.waiters.push(() => { e.active += 1; resolve(); }));
}

function releaseSlot(key: string): void {
  const e = providerSlots.get(key);
  if (!e) return;
  const next = e.waiters.shift();
  if (next) next();
  else e.active = Math.max(0, e.active - 1);
}

/** Aborta las sesiones activas de un run (canal de control). */
export function abortRun(runId: string): void {
  const e = active.get(runId);
  if (!e) return;
  e.pause = true;
  for (const h of e.handles) void h.abort().catch(() => {});
}

/** Solicita pausa al finalizar el paso en curso. */
export function requestPause(runId: string): void {
  const e = active.get(runId);
  if (e) e.pause = true;
}

async function checkBudget(
  project: { id: string },
  runId: string,
  emit: (stepRunId: string | null, source: string, message: string, level?: string, payload?: Record<string, unknown>) => Promise<void>,
): Promise<boolean> {
  const [budget] = await db.select().from(projectBudgets).where(eq(projectBudgets.projectId, project.id)).limit(1);
  if (!budget || (!budget.limitUsd && !budget.softLimitUsd)) return false;
  const rows = await db
    .select({ cost: usageRecords.cost })
    .from(usageRecords)
    .innerJoin(workflowRuns, eq(workflowRuns.id, usageRecords.runId))
    .where(eq(workflowRuns.projectId, project.id));
  const total = rows.reduce((acc, r) => acc + Number(r.cost), 0);
  const notify = (type: string, message: string) => {
    if (!budget.webhookUrl) return;
    void fetch(budget.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, projectId: project.id, cost: total, message }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  };
  if (budget.softLimitUsd && total >= Number(budget.softLimitUsd) && !budget.alertedAt) {
    await db.update(projectBudgets).set({ alertedAt: new Date() }).where(eq(projectBudgets.id, budget.id));
    await emit(null, "orchestrator", `Aviso de coste: ${total.toFixed(4)} supera el límite blando (${budget.softLimitUsd})`, "warn");
    notify("soft-limit", `Coste ${total.toFixed(4)} supera el límite blando (${budget.softLimitUsd})`);
  }
  if (budget.limitUsd && total >= Number(budget.limitUsd)) {
    await emit(null, "orchestrator", `Coste ${total.toFixed(4)} supera el límite duro (${budget.limitUsd}); pausando el run`, "error");
    notify("hard-limit", `Coste ${total.toFixed(4)} supera el límite duro (${budget.limitUsd}); ejecuciones pausadas`);
    await db.update(workflowRuns).set({ status: "paused" }).where(eq(workflowRuns.id, runId));
    return true;
  }
  return false;
}

async function evaluateContracts(
  project: { id: string; ownerId: string; assistantModelId: string | null },
  workspaceDir: string,
): Promise<boolean> {
  const list = await db.select().from(contractsTable).where(eq(contractsTable.projectId, project.id));
  if (list.length === 0) return true;
  const now = new Date();
  for (const contract of list) {
    // Se re-verifica SIEMPRE: un contrato "satisfied" de un run anterior no
    // garantiza que los ficheros sigan existiendo.
    if (contract.verification === "command") {
      const r = await runCapture(contract.criterion, workspaceDir);
      await db
        .update(contractsTable)
        .set({
          status: r.code === 0 ? "satisfied" : "failed",
          evidence: { exitCode: r.code, output: r.output.slice(0, 400) },
          lastVerifiedAt: now,
        })
        .where(eq(contractsTable.id, contract.id));
    } else if (contract.verification === "llm") {
      const ep = project.assistantModelId ? await modelEndpoint(project.ownerId, project.assistantModelId) : null;
      const verdict = ep
        ? await aiJudge(ep.provider, ep.modelId, { expectedResult: contract.criterion, output: contract.criterion })
        : { passed: false, reasons: ["Sin modelo de verificación configurado"], evidence: { judge: "none" } };
      await db
        .update(contractsTable)
        .set({
          status: verdict.passed ? "satisfied" : "failed",
          evidence: verdict as unknown as Record<string, unknown>,
          lastVerifiedAt: now,
        })
        .where(eq(contractsTable.id, contract.id));
    }
  }
  const refreshed = await db.select().from(contractsTable).where(eq(contractsTable.projectId, project.id));
  return refreshed.every((c) => c.status === "satisfied");
}

/** Sella una decisión en el ledger encadenado por hash del proyecto. */
async function recordLedger(
  projectId: string,
  runId: string | null,
  stepRunId: string | null,
  input: { gate: LedgerEntry["gate"]; outcome: LedgerEntry["outcome"]; reason: string; ruleId?: string; klass?: LedgerEntry["klass"]; payload?: Record<string, unknown> },
): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(policyDecisions)
      .where(eq(policyDecisions.projectId, projectId))
      .orderBy(asc(policyDecisions.seq));
    const entries: LedgerEntry[] = rows.map((r) => ({
      seq: r.seq,
      gate: r.gate as LedgerEntry["gate"],
      outcome: r.outcome as LedgerEntry["outcome"],
      reason: r.reason,
      ruleId: r.ruleId ?? undefined,
      klass: r.klass ?? undefined,
      payload: r.payload ?? undefined,
      createdAt: r.createdAt.toISOString(),
      prevHash: r.prevHash ?? undefined,
      hash: r.hash,
    }));
    const entry = appendEntry(entries, { ...input, createdAt: new Date().toISOString() });
    await db.insert(policyDecisions).values({
      projectId,
      runId: runId ?? undefined,
      stepRunId: stepRunId ?? undefined,
      seq: entry.seq,
      gate: entry.gate as never,
      outcome: entry.outcome as never,
      ruleId: entry.ruleId,
      klass: entry.klass,
      reason: entry.reason,
      payload: entry.payload,
      prevHash: entry.prevHash,
      hash: entry.hash,
      createdAt: new Date(entry.createdAt ?? Date.now()),
    });
  } catch (error) {
    console.warn(`[worker] no se pudo escribir el ledger: ${error instanceof Error ? error.message : error}`);
  }
}
