import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { EmptyState, SkeletonRows, Spinner, StatusBadge, useConfirm, useToast } from "../components/ui.tsx";
import { FlowDiagram } from "../components/FlowDiagram.tsx";
import { api, type RunEvent, type TraceSpan } from "../lib/api.ts";

type Tab = "general" | "features" | "contracts" | "documents" | "flow" | "files" | "environment" | "method" | "runs" | "assistant";

export function ProjectDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.project(id), refetchInterval: 4000 });
  const workflows = useQuery({ queryKey: ["workflows"], queryFn: api.workflows });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const runs = useQuery({ queryKey: ["runs", id], queryFn: () => api.runs(id), refetchInterval: 3000 });
  const [params, setParams] = useSearchParams();
  const validTabs: Tab[] = ["general", "features", "contracts", "documents", "flow", "files", "environment", "method", "runs", "assistant"];
  const tabFromUrl = params.get("tab") as Tab | null;
  const [tab, setTabState] = useState<Tab>(tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "general");
  const setTab = (t: Tab) => {
    setTabState(t);
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (tabFromUrl && validTabs.includes(tabFromUrl)) setTabState(tabFromUrl);
  }, [tabFromUrl]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["project", id] });

  const startRun = useMutation({
    mutationFn: () => api.startRun(id, project.data?.workflowId ?? undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["runs", id] }); setTab("runs"); toast("Ejecución lanzada", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  if (project.isLoading)
    return (
      <div className="panel">
        <SkeletonRows rows={5} />
      </div>
    );
  if (project.isError) return <div className="panel error-box">No se pudo cargar el proyecto: {(project.error as Error).message}</div>;
  if (!project.data) return <div className="panel">Proyecto no encontrado.</div>;
  const p = project.data;

  const activeRun = runs.data?.some((r) => r.status === "running");
  const tabs: [Tab, string, number][] = [
    ["general", "General", 0],
    ["features", "Funcionalidades", p.features.length],
    ["contracts", "Contratos", p.contracts.length],
    ["documents", "Documentación", p.documents.length],
    ["flow", "Flujo", 0],
    ["files", "Archivos", 0],
    ["environment", "Entorno", 0],
    ["method", "Método", 0],
    ["runs", "Ejecuciones", runs.data?.length ?? 0],
    ["assistant", "Asistente", 0],
  ];

  return (
    <>
      <div className="topbar">
        <div style={{ minWidth: 0 }}>
          <h1 className="row" style={{ gap: "0.6rem" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            <StatusBadge status={p.status} pulse={activeRun} />
          </h1>
          <div className="muted">{p.programName}</div>
        </div>
        <button onClick={() => startRun.mutate()} disabled={startRun.isPending || !p.workflowId} title={!p.workflowId ? "Asigna un flujo primero (pestaña General)" : undefined}>
          {startRun.isPending ? <Spinner /> : "▶ Lanzar ejecución"}
        </button>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([t, label, count]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {label}
            {count > 0 && <span className="badge" style={{ marginLeft: "0.4rem" }}>{count}</span>}
          </button>
        ))}
      </div>

      {tab === "general" && <General p={p} workflows={workflows.data ?? []} models={models.data ?? []} onSaved={invalidate} />}
      {tab === "features" && <Features id={id} features={p.features} onChange={invalidate} />}
      {tab === "contracts" && <Contracts id={id} contracts={p.contracts} onChange={invalidate} />}
      {tab === "documents" && <Documents id={id} documents={p.documents} onChange={invalidate} />}
      {tab === "flow" && <Flow projectId={id} projectWorkflowId={p.workflowId} workflows={workflows.data ?? []} runs={runs.data ?? []} />}
      {tab === "files" && <WorkspaceFiles id={id} />}
      {tab === "environment" && <Environment id={id} project={p} />}
      {tab === "method" && <Method id={id} />}
      {tab === "runs" && <Runs id={id} runs={runs} initialRunId={params.get("run") ?? undefined} />}
      {tab === "assistant" && <Assistant id={id} onChange={invalidate} />}
    </>
  );
}

function General({ p, workflows, models, onSaved }: { p: any; workflows: any[]; models: any[]; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    objective: p.objective,
    description: p.description ?? "",
    stack: (p.stack ?? []).join(", "),
    workflowId: p.workflowId ?? "",
    assistantModelId: p.assistantModelId ?? "",
    embeddingModelId: p.embeddingModelId ?? "",
    rerankModelId: p.rerankModelId ?? "",
    repoProvider: p.repoProvider ?? "github",
    repoUrl: p.repoUrl ?? "",
    repoBranch: p.repoBranch ?? "",
    repoToken: "",
    containerImage: p.containerImage ?? "",
    containerNetworkMode: p.containerNetworkMode ?? "closed",
  });
  const embeddingModels = models.filter((m) => m.capabilities.includes("embeddings"));
  const rerankModels = models.filter((m) => m.capabilities.includes("rerank"));

  const save = useMutation({
    mutationFn: () => api.updateProject(p.id, {
      objective: form.objective,
      description: form.description,
      stack: form.stack.split(",").map((s: string) => s.trim()).filter(Boolean),
      workflowId: form.workflowId || null,
      assistantModelId: form.assistantModelId || null,
      embeddingModelId: form.embeddingModelId || null,
      rerankModelId: form.rerankModelId || null,
      repoProvider: form.repoProvider || null,
      repoUrl: form.repoUrl || null,
      repoBranch: form.repoBranch || null,
      ...(form.repoToken ? { repoToken: form.repoToken } : {}),
      containerImage: form.containerImage || null,
      containerNetworkMode: form.containerNetworkMode,
    }),
    onSuccess: () => { setForm((f) => ({ ...f, repoToken: "" })); onSaved(); toast("Cambios guardados", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const repoTest = useMutation({
    mutationFn: () => api.repoTest(p.id, {
      repoUrl: form.repoUrl || undefined,
      repoToken: form.repoToken || undefined,
      repoProvider: form.repoProvider,
    }),
    onSuccess: (r) => toast(r.ok ? `Acceso correcto (${r.branches.length} ramas)` : r.message, r.ok ? "ok" : "err"),
    onError: (e: Error) => toast(e.message, "err"),
  });

  const budget = useQuery({ queryKey: ["budget", p.id], queryFn: () => api.getBudget(p.id) });
  const usage = useQuery({ queryKey: ["usage", p.id], queryFn: () => api.projectUsage(p.id) });
  const [budgetForm, setBudgetForm] = useState({ limitUsd: "", softLimitUsd: "", webhookUrl: "" });
  useEffect(() => {
    if (budget.data) setBudgetForm({ limitUsd: budget.data.limitUsd ?? "", softLimitUsd: budget.data.softLimitUsd ?? "", webhookUrl: budget.data.webhookUrl ?? "" });
  }, [budget.data]);
  const saveBudget = useMutation({
    mutationFn: () => api.setBudget(p.id, {
      limitUsd: budgetForm.limitUsd ? Number(budgetForm.limitUsd) : undefined,
      softLimitUsd: budgetForm.softLimitUsd ? Number(budgetForm.softLimitUsd) : undefined,
      webhookUrl: budgetForm.webhookUrl || undefined,
    }),
    onSuccess: () => { budget.refetch(); toast("Presupuesto guardado", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <div className="grid two">
      <div className="panel">
        <h2>Definición</h2>
        <div className="field">
          <label htmlFor="gen-obj">Objetivo</label>
          <textarea id="gen-obj" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="gen-desc">Descripción</label>
          <textarea id="gen-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="gen-stack">Stack (separado por comas)</label>
          <input id="gen-stack" value={form.stack} onChange={(e) => setForm({ ...form, stack: e.target.value })} placeholder="typescript, react, postgres" />
        </div>
        <div className="field">
          <label htmlFor="gen-wf">Flujo de trabajo</label>
          <select id="gen-wf" value={form.workflowId} onChange={(e) => setForm({ ...form, workflowId: e.target.value })}>
            <option value="">—</option>
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="grid two">
          <div className="field">
            <label htmlFor="gen-repop">Proveedor Git</label>
            <select id="gen-repop" value={form.repoProvider} onChange={(e) => setForm({ ...form, repoProvider: e.target.value })}>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
              <option value="other">Otro</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="gen-branch">Rama</label>
            <input id="gen-branch" value={form.repoBranch} onChange={(e) => setForm({ ...form, repoBranch: e.target.value })} placeholder="main" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="gen-repo">Repositorio (URL)</label>
          <input id="gen-repo" value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} placeholder="https://github.com/org/repo.git" />
        </div>
        <div className="field">
          <label htmlFor="gen-token">Token de acceso ({form.repoProvider}) {p.hasRepoToken && <span className="muted">· ya configurado</span>}</label>
          <div className="row">
            <input id="gen-token" type="password" value={form.repoToken} onChange={(e) => setForm({ ...form, repoToken: e.target.value })} placeholder={p.hasRepoToken ? "••••••• (dejar vacío para conservar)" : "ghp_… / glpat-…"} style={{ flex: 1 }} />
            <button type="button" className="ghost small" onClick={() => repoTest.mutate()} disabled={repoTest.isPending || !form.repoUrl}>Probar acceso</button>
          </div>
        </div>
        <div className="grid two">
          <div className="field">
            <label htmlFor="gen-img">Imagen del contenedor</label>
            <input id="gen-img" value={form.containerImage} onChange={(e) => setForm({ ...form, containerImage: e.target.value })} placeholder="factoria/project-dev:latest" />
          </div>
          <div className="field">
            <label htmlFor="gen-net">Red del contenedor</label>
            <select id="gen-net" value={form.containerNetworkMode} onChange={(e) => setForm({ ...form, containerNetworkMode: e.target.value })}>
              <option value="closed">Cerrada (sin egreso)</option>
              <option value="allowlist">Allowlist</option>
              <option value="open">Abierta</option>
            </select>
          </div>
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Spinner /> : "Guardar cambios"}</button>
      </div>

      <div>
        <div className="panel">
          <h2>Modelos del proyecto</h2>
          <div className="field">
            <label htmlFor="gen-model">Modelo del asistente</label>
            <select id="gen-model" value={form.assistantModelId} onChange={(e) => setForm({ ...form, assistantModelId: e.target.value })}>
              <option value="">—</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="gen-embed">Modelo de embeddings (RAG)</label>
            <select id="gen-embed" value={form.embeddingModelId} onChange={(e) => setForm({ ...form, embeddingModelId: e.target.value })}>
              <option value="">—</option>
              {embeddingModels.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="gen-rerank">Modelo de rerank</label>
            <select id="gen-rerank" value={form.rerankModelId} onChange={(e) => setForm({ ...form, rerankModelId: e.target.value })}>
              <option value="">—</option>
              {rerankModels.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </select>
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Spinner /> : "Guardar modelos"}</button>
        </div>

        <div className="panel">
          <h2>Presupuesto y coste</h2>
          {usage.data && (
            <p className="muted">Consumo: {usage.data.totals.inputTokens.toLocaleString()} + {usage.data.totals.outputTokens.toLocaleString()} tokens · ${usage.data.totals.cost.toFixed(4)} en {usage.data.records} registros.</p>
          )}
          <div className="grid two">
            <div className="field">
              <label htmlFor="b-soft">Límite blando (USD)</label>
              <input id="b-soft" type="number" value={budgetForm.softLimitUsd} onChange={(e) => setBudgetForm({ ...budgetForm, softLimitUsd: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="b-hard">Límite duro (USD)</label>
              <input id="b-hard" type="number" value={budgetForm.limitUsd} onChange={(e) => setBudgetForm({ ...budgetForm, limitUsd: e.target.value })} />
            </div>
          </div>
          <div className="field" style={{ marginTop: "0.6rem" }}>
            <label htmlFor="b-hook">Webhook de alertas</label>
            <div className="row">
              <input id="b-hook" value={budgetForm.webhookUrl ?? ""} onChange={(e) => setBudgetForm({ ...budgetForm, webhookUrl: e.target.value })} placeholder="https://…/alertas" style={{ flex: 1 }} />
              <button className="ghost small" onClick={() => api.testWebhook(p.id).then((r) => toast(r.ok ? "Webhook OK" : "Falló el webhook", r.ok ? "ok" : "err")).catch((e: Error) => toast(e.message, "err"))}>Probar</button>
            </div>
          </div>
          <button className="ghost" onClick={() => saveBudget.mutate()} disabled={saveBudget.isPending}>Guardar presupuesto</button>
          <CostBreakdown pid={p.id} />
        </div>
      </div>
    </div>
  );
}

function Environment({ id, project }: { id: string; project: any }) {
  const toast = useToast();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["container", id], queryFn: () => api.containerStatus(id), refetchInterval: 4000 });
  const preview = useQuery({ queryKey: ["preview-info", id], queryFn: () => api.previewInfo(id) });
  const app = useQuery({ queryKey: ["app-status", id], queryFn: () => api.appStatus(id), refetchInterval: 4000 });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["container", id] });
    qc.invalidateQueries({ queryKey: ["app-status", id] });
    qc.invalidateQueries({ queryKey: ["preview-info", id] });
  };
  const up = useMutation({ mutationFn: () => api.containerUp(id), onSuccess: (r) => { invalidate(); toast(r.running ? "Contenedor arrancado" : `Error: ${r.error ?? "desconocido"}`, r.running ? "ok" : "err"); }, onError: (e: Error) => toast(e.message, "err") });
  const down = useMutation({ mutationFn: () => api.containerDown(id), onSuccess: () => { invalidate(); toast("Contenedor detenido", "ok"); }, onError: (e: Error) => toast(e.message, "err") });
  const rebuild = useMutation({ mutationFn: () => api.containerRebuild(id), onSuccess: (r) => { invalidate(); toast(r.running ? "Contenedor reconstruido" : `Error: ${r.error ?? "desconocido"}`, r.running ? "ok" : "err"); }, onError: (e: Error) => toast(e.message, "err") });
  const logs = useMutation({ mutationFn: () => api.containerLogs(id), onSuccess: (r) => toast(r.logs.slice(0, 200) || "Sin logs", "ok"), onError: (e: Error) => toast(e.message, "err") });

  const [devCommand, setDevCommand] = useState<string>(project.devCommand ?? "");
  const [devPort, setDevPort] = useState<number>(project.devPort ?? 3000);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    setDevCommand(project.devCommand ?? "");
    setDevPort(project.devPort ?? 3000);
  }, [project.id, project.devCommand, project.devPort]);

  const saveDev = useMutation({
    mutationFn: () => api.updateProject(id, { devCommand, devPort }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", id] }); invalidate(); toast("Configuración de la app guardada", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const startApp = useMutation({
    mutationFn: () => api.appStart(id),
    onSuccess: (r) => { invalidate(); toast(r.running ? (r.endpoint ? `App arrancada en ${r.endpoint}` : "App arrancada") : "No se pudo arrancar", r.running ? "ok" : "err"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const stopApp = useMutation({
    mutationFn: () => api.appStop(id),
    onSuccess: () => { invalidate(); toast("App detenida", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const appLogs = useMutation({
    mutationFn: () => api.appLogs(id),
    onSuccess: (r) => toast(r.logs.slice(-400) || "Sin logs de la app", "ok"),
    onError: (e: Error) => toast(e.message, "err"),
  });

  const s = status.data;
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const appUrl = app.data?.hostPort ? `http://${host}:${app.data.hostPort}` : app.data?.endpoint ?? null;
  const suggestedCommand = preview.data?.scripts?.dev
    ? `npm run dev -- --host 0.0.0.0 --port ${devPort}`
    : preview.data?.scripts?.start
      ? "npm start"
      : "";

  return (
    <div className="grid two">
      <div className="panel">
        <h2>Contenedor de desarrollo</h2>
        <p className="muted">El proyecto se desarrolla dentro de un contenedor aislado. Se arranca automáticamente al lanzar una ejecución.</p>
        <div className="row" style={{ gap: "0.6rem", marginTop: "0.6rem" }}>
          <StatusBadge status={s?.status ?? "unknown"} pulse={s?.status === "starting"} />
          {s && <span className="muted">{s.name} · {s.image} {s.endpoint ? `· ${s.endpoint}` : ""}</span>}
        </div>
        {!s?.available && <p className="muted" style={{ marginTop: "0.5rem" }}>El motor de contenedores no está disponible.</p>}
        {s?.lastError && <p className="error-box" style={{ marginTop: "0.5rem" }}>{s.lastError}</p>}
        <div className="row" style={{ gap: "0.5rem", marginTop: "0.9rem" }}>
          <button onClick={() => up.mutate()} disabled={up.isPending || s?.status === "running"}>Arrancar</button>
          <button className="ghost" onClick={() => down.mutate()} disabled={down.isPending || s?.status !== "running"}>Parar</button>
          <button className="ghost" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>Reconstruir</button>
          <button className="ghost small" onClick={() => logs.mutate()} disabled={logs.isPending}>Ver logs</button>
        </div>
      </div>
      <div className="panel">
        <h2>Configuración</h2>
        <p className="muted">Imagen: <code>{project.containerImage ?? "factoria/project-dev:latest"}</code></p>
        <p className="muted">Red: <code>{project.containerNetworkMode ?? "closed"}</code></p>
        <p className="muted">Repositorio: <code>{project.repoUrl ?? "sin configurar"}</code> {project.hasRepoToken && "· con token"}</p>
        <p className="muted">Ajusta estos valores en la pestaña General.</p>
      </div>

      <div className="panel" style={{ gridColumn: "1 / -1" }}>
        <h2>Aplicación desarrollada</h2>
        {preview.isLoading ? (
          <SkeletonRows rows={3} />
        ) : !preview.data?.exists ? (
          <EmptyState icon="⌂" title="Workspace no inicializado" hint="Se creará al lanzar la primera ejecución del proyecto." />
        ) : (
          <>
            {preview.data.hasIndex && (
              <div style={{ marginBottom: "1rem" }}>
                <div className="row spread" style={{ marginBottom: "0.5rem" }}>
                  <h3 style={{ margin: 0 }}>Vista previa estática</h3>
                  <div className="row" style={{ gap: "0.4rem" }}>
                    <button className="ghost small" onClick={() => setReloadKey((k) => k + 1)}>Recargar</button>
                    <a className="ghost small button-like" href={api.previewUrl(id)} target="_blank" rel="noreferrer">Abrir en pestaña</a>
                  </div>
                </div>
                <iframe
                  key={reloadKey}
                  title="Vista previa estática"
                  src={api.previewUrl(id)}
                  style={{ width: "100%", height: 480, border: "1px solid var(--border)", borderRadius: 8, background: "#000" }}
                />
              </div>
            )}

            <div>
              <h3 style={{ marginTop: 0 }}>Servidor de desarrollo</h3>
              <p className="muted">
                Para apps con servidor (Vite, Next, Express…). El comando se ejecuta dentro del contenedor del proyecto y escucha en el puerto indicado.
              </p>
              <div className="row" style={{ gap: "0.6rem", flexWrap: "wrap" }}>
                <label style={{ flex: 1, minWidth: 260 }}>
                  Comando
                  <input
                    value={devCommand}
                    onChange={(e) => setDevCommand(e.target.value)}
                    placeholder={suggestedCommand || "npm run dev -- --host 0.0.0.0 --port 3000"}
                    style={{ width: "100%" }}
                  />
                </label>
                <label>
                  Puerto
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={devPort}
                    onChange={(e) => setDevPort(Number(e.target.value) || 3000)}
                    style={{ width: 110 }}
                  />
                </label>
                <button className="ghost" onClick={() => saveDev.mutate()} disabled={saveDev.isPending}>Guardar</button>
              </div>
              {suggestedCommand && !devCommand && (
                <p className="muted" style={{ marginTop: "0.4rem" }}>
                  Detectado: <code>{suggestedCommand}</code>{" "}
                  <button className="ghost small" onClick={() => setDevCommand(suggestedCommand)}>Usar</button>
                </p>
              )}
              <div className="row" style={{ gap: "0.5rem", marginTop: "0.8rem", flexWrap: "wrap" }}>
                <StatusBadge status={app.data?.running ? "running" : "stopped"} pulse={app.data?.running} />
                <button onClick={() => startApp.mutate()} disabled={startApp.isPending}>Arrancar app</button>
                <button className="ghost" onClick={() => stopApp.mutate()} disabled={stopApp.isPending || !app.data?.running}>Parar app</button>
                <button className="ghost small" onClick={() => appLogs.mutate()} disabled={appLogs.isPending}>Ver logs</button>
                {appUrl && <a className="small button-like" href={appUrl} target="_blank" rel="noreferrer">Abrir app</a>}
                {app.data?.hostPort && <span className="muted">Puerto host: {app.data.hostPort}</span>}
              </div>
              {app.data?.running && appUrl && (
                <iframe
                  title="Aplicación en ejecución"
                  src={appUrl}
                  style={{ width: "100%", height: 520, marginTop: "0.8rem", border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Method({ id }: { id: string }) {
  const gov = useQuery({ queryKey: ["governance", id], queryFn: () => api.governance(id), refetchInterval: 5000 });
  const reviews = useQuery({ queryKey: ["reviews", id], queryFn: () => api.reviews(id) });
  const adrs = useQuery({ queryKey: ["adrs", id], queryFn: () => api.adrs(id) });
  const claims = useQuery({ queryKey: ["claims", id], queryFn: () => api.claims(id) });
  const policies = useQuery({ queryKey: ["policies", id], queryFn: () => api.policies(id) });
  const toast = useToast();
  const anchor = useMutation({ mutationFn: () => api.governanceAnchor(id), onSuccess: (r) => toast(`Ledger anclado (${r.head.slice(0, 12)}…)`, "ok"), onError: (e: Error) => toast(e.message, "err") });
  const compile = useMutation({ mutationFn: () => api.compilePolicies(id), onSuccess: (r) => { policies.refetch(); toast(`${r.proposed} reglas propuestas`, "ok"); }, onError: (e: Error) => toast(e.message, "err") });

  const rep = gov.data?.report;
  return (
    <div className="grid two">
      <div className="panel">
        <h2>Gobernanza</h2>
        {rep ? (
          <>
            <p className="muted">Decisiones: {rep.total} · Denegaciones: {rep.denies} · Excepciones: {rep.exceptions}</p>
            <p className="muted">Cadena: {rep.chain.ok ? "íntegra ✓" : `manipulada en #${rep.chain.brokenAt}`} · head <code>{rep.head.slice(0, 16)}…</code></p>
            <button className="ghost small" onClick={() => anchor.mutate()} disabled={anchor.isPending}>Anclar head</button>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "0.9rem" }}>
              {(gov.data?.entries ?? []).slice(-20).reverse().map((e) => (
                <li key={e.seq} className="row spread" style={{ borderBottom: "1px solid var(--border)", padding: "0.35rem 0" }}>
                  <span className="muted">#{e.seq} [{e.gate}]</span>
                  <span>{e.outcome === "deny" ? "⛔" : e.outcome === "exception" ? "⚠️" : "✓"} {e.reason.slice(0, 70)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="muted">Sin decisiones registradas.</p>}
      </div>

      <div>
        <div className="panel">
          <h2>Revisiones cross-AI</h2>
          {(reviews.data ?? []).length ? (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {(reviews.data ?? []).slice(0, 12).map((r) => (
                <li key={r.id} className="row spread" style={{ borderBottom: "1px solid var(--border)", padding: "0.35rem 0" }}>
                  <span>{r.verdict === "approved" ? "✓" : "✗"} {r.diffHash.slice(0, 10)}</span>
                  <span className="muted">{r.reviewerModelId ?? r.reviewerModelId ?? ""} {r.summary ? `— ${r.summary.slice(0, 40)}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Sin revisiones.</p>}
        </div>

        <div className="panel">
          <h2>ADRs</h2>
          {(adrs.data ?? []).length ? (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {(adrs.data ?? []).map((a) => (
                <li key={a.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.35rem 0" }}>
                  <strong>ADR {a.number}</strong> · {a.title} <span className="muted">[{a.status}]</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Sin ADRs.</p>}
        </div>

        <div className="panel">
          <h2>Afirmaciones (claims)</h2>
          {(claims.data ?? []).length ? (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {(claims.data ?? []).slice(0, 12).map((c) => (
                <li key={c.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.35rem 0" }}>
                  {c.status === "disproven" ? "⛔" : c.status === "backed" ? "✓" : "?"} {c.text.slice(0, 90)}
                </li>
              ))}
            </ul>
          ) : <p className="muted">Sin afirmaciones registradas.</p>}
        </div>

        <div className="panel">
          <h2>Reglas (políticas)</h2>
          <button className="ghost small" onClick={() => compile.mutate()} disabled={compile.isPending}>Compilar desde AGENTS.md</button>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "0.6rem" }}>
            {(policies.data?.rules ?? []).map((r) => (
              <li key={r.id} className="row spread" style={{ borderBottom: "1px solid var(--border)", padding: "0.35rem 0" }}>
                <span>{r.literalText.slice(0, 70)} <span className="muted">[{r.kind}]</span></span>
                {!r.approved && <button className="ghost small" onClick={() => api.approvePolicy(id, r.ruleId).then(() => policies.refetch()).catch((e: Error) => toast(e.message, "err"))}>Aprobar</button>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Features({ id, features, onChange }: { id: string; features: any[]; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: () => api.addFeature(id, { title }),
    onSuccess: () => { setTitle(""); onChange(); toast("Funcionalidad añadida", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const remove = useMutation({
    mutationFn: async (fid: string) => {
      const ok = await confirm({ title: "¿Borrar funcionalidad?", confirmLabel: "Borrar" });
      if (!ok) return;
      await api.deleteFeature(id, fid);
      return true;
    },
    onSuccess: (deleted) => { if (deleted) onChange(); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  return (
    <div className="panel">
      <form className="row" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} style={{ marginBottom: "0.9rem" }}>
        <input placeholder="Nueva funcionalidad…" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
        <button type="submit" disabled={!title.trim() || add.isPending}>{add.isPending ? <Spinner /> : "Añadir"}</button>
      </form>
      {features.length ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {features.map((f) => (
            <li key={f.id} className="row spread" style={{ borderBottom: "1px solid var(--border)", padding: "0.45rem 0" }}>
              <span>{f.title} {f.description && <span className="muted">— {f.description}</span>}</span>
              <button className="danger small" onClick={() => remove.mutate(f.id)} disabled={remove.isPending}>Borrar</button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="✦" title="Sin funcionalidades" hint="Enumera qué debe hacer el software. El asistente puede proponérmelas por ti en la pestaña Asistente." />
      )}
    </div>
  );
}

function Contracts({ id, contracts, onChange }: { id: string; contracts: any[]; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState({ title: "", criterion: "", verification: "llm" });
  const add = useMutation({
    mutationFn: () => api.addContract(id, f),
    onSuccess: () => { setF({ title: "", criterion: "", verification: "llm" }); onChange(); toast("Contrato añadido", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const remove = useMutation({
    mutationFn: async (cid: string) => {
      const ok = await confirm({ title: "¿Borrar contrato?", confirmLabel: "Borrar" });
      if (!ok) return;
      await api.deleteContract(id, cid);
      return true;
    },
    onSuccess: (deleted) => { if (deleted) onChange(); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  return (
    <div className="panel">
      <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} style={{ marginBottom: "0.9rem" }}>
        <div className="grid two">
          <div className="field">
            <label htmlFor="con-title">Título</label>
            <input id="con-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="con-ver">Verificación</label>
            <select id="con-ver" value={f.verification} onChange={(e) => setF({ ...f, verification: e.target.value })}>
              <option value="llm">juez IA</option>
              <option value="command">comando</option>
              <option value="manual">manual</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="con-crit">Criterio de aceptación</label>
          <textarea id="con-crit" value={f.criterion} onChange={(e) => setF({ ...f, criterion: e.target.value })} placeholder="Comprobable y objetivo: «el endpoint GET /health devuelve 200»" />
        </div>
        <button type="submit" disabled={!f.title.trim() || !f.criterion.trim() || add.isPending}>{add.isPending ? <Spinner /> : "Añadir contrato"}</button>
      </form>
      {contracts.length ? (
        <table>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.title}</strong><div className="muted">{c.criterion}</div></td>
                <td><StatusBadge status={c.status} /></td>
                <td style={{ textAlign: "right" }}>
                  <button className="danger small" onClick={() => remove.mutate(c.id)} disabled={remove.isPending}>Borrar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState icon="§" title="Sin contratos" hint="Los contratos son criterios de aceptación verificables. El proyecto podrá finalizar sin gate hasta que definas alguno." />
      )}
    </div>
  );
}

function Documents({ id, documents, onChange }: { id: string; documents: any[]; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [imageModel, setImageModel] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (f: File) =>
      new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          api
            .uploadDocument(id, {
              filename: f.name,
              mimeType: f.type || undefined,
              dataBase64: String(reader.result).split(",")[1] ?? "",
            })
            .then(() => resolve())
            .catch((e: Error) => reject(e));
        reader.onerror = () => reject(new Error("No se pudo leer el fichero"));
        reader.readAsDataURL(f);
      }),
    onSuccess: () => { onChange(); toast("Documento subido e indexado", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const imageModels = (models.data ?? []).filter((m) => m.capabilities.includes("imageGeneration"));
  useEffect(() => {
    if (!imageModel && imageModels.length > 0) setImageModel(imageModels[0]!.id);
  }, [imageModels, imageModel]);
  const addDoc = useMutation({
    mutationFn: () => api.addDocument(id, { type: "reference", title, text }),
    onSuccess: () => { setTitle(""); setText(""); onChange(); toast("Documento añadido", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const genImage = useMutation({
    mutationFn: () => api.generateImage(id, prompt, imageModel || undefined),
    onSuccess: () => { setPrompt(""); onChange(); toast("Imagen generada", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const remove = useMutation({
    mutationFn: async (did: string) => {
      const ok = await confirm({ title: "¿Borrar documento?", confirmLabel: "Borrar" });
      if (!ok) return;
      await api.deleteDocument(id, did);
      return true;
    },
    onSuccess: (deleted) => { if (deleted) onChange(); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const images = documents.filter((d) => d.type === "image" || d.type === "sketch");
  const refs = documents.filter((d) => d.type !== "image");
  return (
    <>
    <div className="grid two">
      <div className="panel">
        <h2>Documento de referencia</h2>
        <div className="field">
          <label htmlFor="doc-title">Título</label>
          <input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="doc-text">Texto (se indexa para RAG)</label>
          <textarea id="doc-text" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button onClick={() => addDoc.mutate()} disabled={!title.trim() || addDoc.isPending}>{addDoc.isPending ? <Spinner /> : "Añadir documento"}</button>
        <div className="row" style={{ marginTop: "0.5rem" }}>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.xml,.txt,.md,.json,.csv,.html,.htm,.svg"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <button className="ghost" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Spinner label="Subiendo…" /> : "⬆ Subir documento (PDF, XML, TXT…)"}
          </button>
        </div>
        <div className="hint">Los ficheros se extraen a texto y se indexan en la base de conocimiento RAG.</div>
        {refs.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, marginTop: "0.75rem", marginBottom: 0 }}>
            {refs.map((d) => (
              <li key={d.id} className="row spread" style={{ borderBottom: "1px solid var(--border)", padding: "0.35rem 0" }}>
                <span>{d.title} <StatusBadge status={d.indexedStatus} /></span>
                <button className="danger small" onClick={() => remove.mutate(d.id)} disabled={remove.isPending}>Borrar</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel">
        <h2>Generar imagen (bocetos)</h2>
        <div className="field">
          <label htmlFor="img-model">Modelo de imagen</label>
          <select id="img-model" value={imageModel} onChange={(e) => setImageModel(e.target.value)}>
            {imageModels.length === 0 && <option value="">Sin modelos de imagen</option>}
            {imageModels.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.modelId})</option>)}
          </select>
          {imageModels.length === 0 && <div className="hint">Registra un modelo con capacidad «imageGeneration» en Proveedores y modelos.</div>}
        </div>
        <div className="field">
          <label htmlFor="img-prompt">Prompt</label>
          <textarea id="img-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Boceto de pantalla de login…" />
        </div>
        <button onClick={() => genImage.mutate()} disabled={!prompt.trim() || genImage.isPending || imageModels.length === 0}>
          {genImage.isPending ? <Spinner label="Generando…" /> : "Generar imagen"}
        </button>
        {genImage.isError && <div className="error-box" style={{ marginTop: "0.5rem" }}>{(genImage.error as Error).message}</div>}
        {images.length > 0 && (
          <div className="thumbs" style={{ marginTop: "0.75rem" }}>
            {images.map((d) => (
              <div key={d.id}>
                {d.storagePath && <img src={d.storagePath} alt={d.title} loading="lazy" />}
                <div className="row spread">
                  <span className="muted">{d.title.slice(0, 24)}</span>
                  <button className="danger small" onClick={() => remove.mutate(d.id)} disabled={remove.isPending}>Borrar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    <RagPanel id={id} documents={documents} onChange={onChange} />
    </>
  );
}

function RagPanel({ id, documents, onChange }: { id: string; documents: any[]; onChange: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ title: string; snippet: string; score: number }[] | null>(null);
  const [mode, setMode] = useState("");
  const [memory, setMemory] = useState("");
  const [memResults, setMemResults] = useState<{ id: string; content: string }[] | null>(null);

  const indexDoc = useMutation({ mutationFn: (docId: string) => api.indexDocument(id, docId), onSuccess: () => { onChange(); toast("Documento indexado", "ok"); }, onError: (e: Error) => toast(e.message, "err") });
  const reindex = useMutation({ mutationFn: () => api.reindexProject(id), onSuccess: (r) => { onChange(); toast(`Indexados ${r.indexed}/${r.documents}`, "ok"); }, onError: (e: Error) => toast(e.message, "err") });
  const addMemory = useMutation({ mutationFn: () => api.memoryAdd(id, memory), onSuccess: () => { setMemory(""); toast("Añadido a memoria", "ok"); }, onError: (e: Error) => toast(e.message, "err") });
  const searchMemory = useMutation({ mutationFn: (q: string) => api.memorySearch(id, q), onSuccess: (r) => setMemResults(r), onError: (e: Error) => toast(e.message, "err") });

  const runSearch = async () => {
    try {
      const r = await api.searchProject(id, query);
      setMode(r.mode);
      setResults(r.results);
    } catch (e) { toast((e as Error).message, "err"); }
  };

  return (
    <div className="grid two" style={{ marginTop: "1rem" }}>
      <div className="panel">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>RAG · búsqueda</h2>
          <button className="ghost small" onClick={() => reindex.mutate()} disabled={reindex.isPending}>Reindexar todo</button>
        </div>
        <div className="row" style={{ marginTop: "0.6rem" }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en la documentación…" style={{ flex: 1 }} />
          <button onClick={runSearch} disabled={!query.trim()}>Buscar</button>
        </div>
        {mode && <div className="hint">Modo: {mode}</div>}
        {results && (
          <ul style={{ listStyle: "none", padding: 0, marginTop: "0.5rem" }}>
            {results.map((r, i) => (
              <li key={i} style={{ borderBottom: "1px solid var(--border)", padding: "0.35rem 0" }}>
                <strong>{r.title}</strong> <span className="muted">${Number(r.score).toFixed(3)}</span>
                <div className="muted">{r.snippet}</div>
              </li>
            ))}
            {results.length === 0 && <li className="muted">Sin resultados.</li>}
          </ul>
        )}
        {documents.filter((d) => d.type !== "image").length > 0 && (
          <div style={{ marginTop: "0.5rem" }}>
            <div className="muted" style={{ marginBottom: "0.3rem" }}>Indexar un documento concreto:</div>
            <div className="row">
              {documents.filter((d) => d.type !== "image").map((d) => (
                <button key={d.id} className="ghost small" onClick={() => indexDoc.mutate(d.id)}>{d.title.slice(0, 20)}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Memoria de largo plazo</h2>
        <div className="row">
          <input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="Recordar: decisión, convención…" style={{ flex: 1 }} />
          <button onClick={() => addMemory.mutate()} disabled={!memory.trim()}>Recordar</button>
        </div>
        <div className="row" style={{ marginTop: "0.5rem" }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en memoria…" style={{ flex: 1 }} />
          <button className="ghost" onClick={() => searchMemory.mutate(query)} disabled={!query.trim()}>Buscar</button>
        </div>
        {memResults && (
          <ul style={{ listStyle: "none", padding: 0, marginTop: "0.5rem" }}>
            {memResults.map((m) => <li key={m.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.35rem 0" }}>{m.content}</li>)}
            {memResults.length === 0 && <li className="muted">Sin coincidencias.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

function Flow({ projectId, projectWorkflowId, workflows, runs }: { projectId: string; projectWorkflowId?: string | null; workflows: any[]; runs: any[] }) {
  const wf = workflows.find((w) => w.id === projectWorkflowId);
  const full = useQuery({
    queryKey: ["workflow", projectWorkflowId],
    queryFn: () => api.workflow(projectWorkflowId!),
    enabled: Boolean(projectWorkflowId),
  });

  const latest = runs.find((r) => ["running", "paused", "queued"].includes(r.status)) ?? runs[0];
  const fullRun = useQuery({
    queryKey: ["run", latest?.id],
    queryFn: () => api.run(latest!.id),
    enabled: Boolean(latest),
    refetchInterval: 2500,
  });
  const status: Record<string, string> = {};
  const iterations: Record<string, number> = {};
  if (latest && fullRun.data) {
    const byNode = new Map<string, { status: string; iteration: number }>();
    for (const st of fullRun.data.steps ?? []) {
      const prev = byNode.get(st.nodeKey);
      if (!prev || st.iteration > prev.iteration) byNode.set(st.nodeKey, { status: st.status, iteration: st.iteration });
    }
    for (const [k, v] of byNode) {
      if (["succeeded", "failed", "waiting_approval"].includes(v.status)) status[k] = v.status;
      iterations[k] = v.iteration;
    }
    for (const k of latest.currentNodes ?? []) status[k] = "running";
  }

  return (
    <>
      <div className="panel" style={{ marginBottom: "0.75rem" }}>
        <div className="row spread">
          <span>
            Flujo: {wf ? <Link to={`/workflows/${wf.id}`}><strong>{wf.name}</strong></Link> : <span className="muted">ninguno</span>}
            {wf && <span className="badge" style={{ marginLeft: "0.5rem" }}>v{wf.version}</span>}
          </span>
          <div className="row" style={{ gap: "0.4rem" }}>
            <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#4f8cff", marginRight: 4 }} />en ejecución</span>
            <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#35c07f", marginRight: 4 }} />completado</span>
            <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#ff6b6b", marginRight: 4 }} />fallido</span>
          </div>
        </div>
      </div>
      {full.isLoading ? (
        <div className="panel"><SkeletonRows rows={4} /></div>
      ) : full.data ? (
        <FlowDiagram nodes={full.data.nodes} edges={full.data.edges} status={status} iterations={iterations} />
      ) : (
        <EmptyState icon="⎇" title="Sin flujo asignado" hint="Asígnalo en la pestaña General o crea uno desde plantilla en «Flujos de trabajo»." action={<Link to="/workflows" className="button-like">Ir a flujos</Link>} />
      )}
    </>
  );
}

function Runs({ id, runs, initialRunId }: { id: string; runs: any; initialRunId?: string }) {
  const [selectedRun, setSelectedRun] = useState<string | null>(initialRunId ?? null);
  useEffect(() => { if (initialRunId) setSelectedRun(initialRunId); }, [initialRunId]);
  useEffect(() => { if (!selectedRun && runs.data?.length) setSelectedRun(runs.data[0]!.id); }, [runs.data, selectedRun]);

  return (
    <div className="grid two">
      <div className="panel">
        <h2>Ejecuciones</h2>
        {runs.isLoading ? (
          <SkeletonRows rows={3} />
        ) : runs.data?.length ? (
          <table>
            <tbody>
              {runs.data.map((r: any) => (
                <tr
                  key={r.id}
                  className={`clickable${selectedRun === r.id ? " selected" : ""}`}
                  onClick={() => setSelectedRun(r.id)}
                  aria-selected={selectedRun === r.id}
                >
                  <td className="muted">{new Date(r.createdAt).toLocaleString()}</td>
                  <td><StatusBadge status={r.status} pulse={r.status === "running"} /></td>
                  <td className="muted">{r.currentNodes?.length ? r.currentNodes.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon="▶" title="Sin ejecuciones" hint="Pulsa «Lanzar ejecución» en la cabecera para arrancar el flujo asignado." />
        )}
      </div>
      <div style={{ minWidth: 0 }}>{selectedRun && <RunStream runId={selectedRun} projectId={id} />}</div>
    </div>
  );
}

function EventLine({ event }: { event: RunEvent }) {
  const kind = typeof event.payload?.kind === "string" ? event.payload.kind : undefined;
  const seq = String(event.seq).padStart(3, "0");
  if (kind === "reasoning") {
    return (
      <div className={`line ${event.level}`} style={{ opacity: 0.88 }}>
        <span className="seq">{seq}</span>
        <span className="muted">[{event.source}]</span> <span className="badge">razonamiento</span>
        <details style={{ marginLeft: "1.2rem" }}>
          <summary style={{ cursor: "pointer" }}>ver razonamiento</summary>
          <pre className="code-preview" style={{ whiteSpace: "pre-wrap", margin: "0.3rem 0" }}>{event.message}</pre>
        </details>
      </div>
    );
  }
  if (kind === "tool") {
    const tool = String(event.payload?.tool ?? "tool");
    const status = event.payload?.status ? String(event.payload.status) : "";
    const detail = { input: event.payload?.input, output: event.payload?.output };
    const hasDetail = detail.input !== undefined || detail.output !== undefined;
    return (
      <div className={`line ${event.level}`}>
        <span className="seq">{seq}</span>
        <span className="muted">[{event.source}]</span> <span className="badge accent">⚙ {tool}</span>{" "}
        {status && <span className="muted">{status}</span>}
        {hasDetail && (
          <details style={{ marginLeft: "1.2rem" }}>
            <summary style={{ cursor: "pointer" }}>detalle</summary>
            <pre className="log code-preview" style={{ maxHeight: 200 }}>{JSON.stringify(detail, null, 2)}</pre>
          </details>
        )}
      </div>
    );
  }
  return (
    <div className={`line ${event.level}`}>
      <span className="seq">{seq}</span>
      <span className="muted">[{event.source}]</span> <span style={{ whiteSpace: "pre-wrap" }}>{event.message}</span>
    </div>
  );
}

function RunStream({ runId, projectId }: { runId: string; projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number; cost: number } | null>(null);
  const [traces, setTraces] = useState<TraceSpan[] | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api.run(runId), refetchInterval: 2500 });

  useEffect(() => {
    setEvents([]);
    setTraces(null);
    const es = new EventSource(`/api/runs/${runId}/stream?sinceSeq=0`);
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as RunEvent;
        setEvents((prev) => (prev.some((e) => e.id === ev.id) ? prev : [...prev, ev]));
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* reconexión automática */ };
    const poll = setInterval(() => api.runUsage(runId).then((u) => setUsage(u.totals)).catch(() => {}), 3000);
    api.runUsage(runId).then((u) => setUsage(u.totals)).catch(() => {});
    return () => { es.close(); clearInterval(poll); };
  }, [runId]);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [events]);

  const control = useMutation({
    mutationFn: (a: "pause" | "resume" | "cancel") =>
      a === "pause" ? api.pauseRun(runId) : a === "resume" ? api.resumeRun(runId) : api.cancelRun(runId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["run", runId] }); qc.invalidateQueries({ queryKey: ["runs"] }); toast("Acción aplicada", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const approve = useMutation({
    mutationFn: ({ stepId, approved }: { stepId: string; approved: boolean }) => api.approveRun(runId, stepId, approved),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["run", runId] }); toast("Aprobación registrada", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const status = run.data?.status ?? "";
  const pending = (run.data?.steps ?? []).filter((s) => s.status === "waiting_approval");
  const failedSteps = (run.data?.steps ?? []).filter((s) => s.status === "failed");
  const failedStep = failedSteps[failedSteps.length - 1];
  const lastErrorEvent = [...events].reverse().find((e) => e.level === "error")?.message;
  const failureReason = failedStep?.error || lastErrorEvent || "Consulta los eventos para ver el detalle.";

  useEffect(() => {
    if (["failed", "succeeded", "cancelled"].includes(status)) {
      qc.invalidateQueries({ queryKey: ["assistant"] });
    }
  }, [status, qc]);

  return (
    <div className="panel">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Observabilidad en vivo</h2>
        <div className="row" style={{ gap: "0.4rem" }}>
          {usage && <span className="badge accent">{(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens · ${usage.cost.toFixed(4)}</span>}
          {status && <StatusBadge status={status} pulse={status === "running"} />}
        </div>
      </div>

      {status === "failed" && (
        <div className="error-box" style={{ marginTop: "0.6rem" }}>
          <strong>La ejecución falló{failedStep ? ` en «${failedStep.nodeKey}»` : ""}.</strong>
          <p style={{ margin: "0.35rem 0" }}>{failureReason}</p>
          <strong style={{ fontSize: "0.88rem" }}>Pasos siguientes</strong>
          <ol style={{ margin: "0.25rem 0 0.5rem 1.2rem", padding: 0 }}>
            <li>Revisa el motivo completo en los eventos de la ejecución.</li>
            {failedStep && <li>Corrige lo necesario y pulsa «Reejecutar desde «{failedStep.nodeKey}»».</li>}
            <li>Si el error es de red o del proveedor, prueba la conexión en «Proveedores y modelos» y vuelve a intentarlo.</li>
          </ol>
          <div className="row" style={{ gap: "0.4rem" }}>
            {failedStep && (
              <button
                className="small"
                onClick={() => api.replayRun(runId, failedStep.nodeKey).then(() => toast("Replay lanzado", "ok")).catch((e: Error) => toast(e.message, "err"))}
              >
                ↻ Reejecutar desde «{failedStep.nodeKey}»
              </button>
            )}
            <Link className="ghost small button-like" to={`/projects/${projectId}?tab=assistant`}>
              Ver explicación del asistente
            </Link>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="warn-box" style={{ marginTop: "0.6rem" }}>
          <strong>⏸ El flujo está esperando tu validación.</strong>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Aprueba o rechaza el paso para continuar; el aviso también se envía al navegador.
          </p>
        </div>
      )}

      <div className="row" style={{ marginTop: "0.6rem", gap: "0.4rem" }}>
        <button className="ghost small" onClick={() => control.mutate("pause")} disabled={status !== "running"}>Pausar</button>
        <button className="ghost small" onClick={() => control.mutate("resume")} disabled={!["paused", "failed"].includes(status)}>Reanudar</button>
        <button className="danger small" onClick={() => control.mutate("cancel")} disabled={!["running", "paused", "queued"].includes(status)}>Cancelar</button>
        <button className="ghost small" onClick={() => api.runTraces(runId).then(setTraces).catch(() => setTraces([]))}>Ver trazas</button>
        <label className="row muted" style={{ gap: "0.3rem", marginLeft: "0.5rem" }}>
          <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
          razonamiento/herramientas
        </label>
      </div>

      {pending.length > 0 && (
        <div className="panel" style={{ marginTop: "0.6rem", background: "var(--panel-2)" }}>
          <h3 style={{ marginTop: 0 }}>Aprobaciones pendientes</h3>
          {pending.map((s) => (
            <div key={s.id} className="row spread">
              <span>{s.nodeKey} <span className="muted">(iteración {s.iteration})</span></span>
              <div className="row">
                <button className="small" onClick={() => approve.mutate({ stepId: s.id, approved: true })}>Aprobar</button>
                <button className="ghost small" onClick={() => approve.mutate({ stepId: s.id, approved: false })}>Rechazar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="log" ref={logRef} style={{ marginTop: "0.75rem" }} aria-live="polite">
        {(showDetails
          ? events
          : events.filter((e) => {
              const kind = typeof e.payload?.kind === "string" ? e.payload.kind : undefined;
              return kind !== "reasoning" && kind !== "tool";
            })
        ).map((e) => (
          <EventLine key={e.id} event={e} />
        ))}
        {events.length === 0 && (
          <EmptyState icon="≡" title="Esperando eventos…" hint="Cuando el run empiece a ejecutar nodos verás aquí el stream en vivo." />
        )}
      </div>

      {traces && (
        <div style={{ marginTop: "0.75rem" }}>
          <div className="row spread">
            <h3 style={{ margin: 0 }}>Trazas (árbol)</h3>
            <a className="ghost small button-like" href={api.tracesOtelUrl(runId)} download={`traces-${runId}.json`}>Exportar OTLP</a>
          </div>
          {traces.length ? (
            <div style={{ marginTop: "0.4rem" }}>
              {traces.filter((t) => !t.parentId).map((root) => (
                <div key={root.id}>
                  <div className="row" style={{ padding: "0.25rem 0", fontWeight: 600 }}>
                    <span>■ {root.name}</span>
                    <span className="badge accent">{(root.inputTokens + root.outputTokens).toLocaleString()} tok · ${Number(root.cost).toFixed(4)}</span>
                  </div>
                  {traces.filter((t) => t.parentId === root.id).map((t) => (
                    <div key={t.id} className="row spread" style={{ padding: "0.15rem 0 0.15rem 1.4rem", borderBottom: "1px dashed var(--border)" }}>
                      <span>
                        {t.kind === "command" ? "⌨" : t.kind === "judge" ? "⚖" : "▪"} {t.name} <span className="muted">({t.kind})</span>
                      </span>
                      <span className="muted">
                        {t.startedAt && t.endedAt ? `${Math.round((new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime()) / 100) / 10}s · ` : ""}
                        {(t.inputTokens + t.outputTokens).toLocaleString()} tok · ${Number(t.cost).toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : <p className="muted">Sin trazas registradas.</p>}
        </div>
      )}
    </div>
  );
}

function Assistant({ id, onChange }: { id: string; onChange: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const messages = useQuery({ queryKey: ["assistant", id], queryFn: () => api.assistantMessages(id) });
  const proposals = useQuery({ queryKey: ["proposals", id], queryFn: () => api.assistantProposals(id) });
  const [input, setInput] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: () => api.assistantSend(id, input),
    onSuccess: () => { setInput(""); qc.invalidateQueries({ queryKey: ["assistant", id] }); qc.invalidateQueries({ queryKey: ["proposals", id] }); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const decide = useMutation({
    mutationFn: ({ pid, decision }: { pid: string; decision: "accept" | "reject" }) => api.assistantDecide(id, pid, decision),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ["proposals", id] }); onChange(); toast(vars.decision === "accept" ? "Propuesta aceptada" : "Propuesta rechazada", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const summarize = useMutation({
    mutationFn: () => api.assistantSummarize(id, 0),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assistant", id] }),
    onError: (e: Error) => toast(e.message, "err"),
  });

  useEffect(() => { chatRef.current?.scrollTo(0, chatRef.current.scrollHeight); }, [messages.data]);

  return (
    <div className="grid two">
      <div className="panel">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Asistente del proyecto</h2>
          <button className="ghost small" onClick={() => summarize.mutate()} disabled={summarize.isPending}>
            {summarize.isPending ? <Spinner /> : "Resumen de ausencia"}
          </button>
        </div>
        <div className="chat" ref={chatRef} style={{ marginTop: "0.75rem" }}>
          {messages.data?.map((m) => <div key={m.id} className={`msg ${m.role}`}>{m.content}</div>)}
          {messages.data?.length === 0 && (
            <EmptyState icon="✉" title="Habla con el asistente" hint="Pregúntale por el proyecto o pídele «propón funcionalidades» y «propón contratos»." />
          )}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); send.mutate(); }} style={{ marginTop: "0.5rem", flexWrap: "nowrap" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe al asistente…" style={{ flex: 1 }} />
          <button type="submit" disabled={!input.trim() || send.isPending} aria-label="Enviar">
            {send.isPending ? <Spinner /> : "Enviar"}
          </button>
        </form>
      </div>
      <div className="panel">
        <h2>Propuestas pendientes</h2>
        {proposals.data?.length ? proposals.data.map((pr) => (
          <div key={pr.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.5rem 0" }}>
            <div><span className="badge accent">{pr.kind}</span></div>
            <pre className="log code-preview" style={{ maxHeight: 160, margin: "0.4rem 0" }}>{JSON.stringify(pr.payload, null, 2)}</pre>
            <div className="row">
              <button className="small" onClick={() => decide.mutate({ pid: pr.id, decision: "accept" })} disabled={decide.isPending}>Aceptar</button>
              <button className="ghost small" onClick={() => decide.mutate({ pid: pr.id, decision: "reject" })} disabled={decide.isPending}>Rechazar</button>
            </div>
          </div>
        )) : <EmptyState icon="☰" title="Sin propuestas pendientes" hint="Cuando el asistente proponga funcionalidades o contratos aparecerán aquí para que las aceptes." />}
      </div>
    </div>
  );
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function WorkspaceFiles({ id }: { id: string }) {
  const [rel, setRel] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const tree = useQuery({ queryKey: ["files", id, rel], queryFn: () => api.listFiles(id, rel) });
  const file = useQuery({
    queryKey: ["file", id, selected],
    queryFn: () => api.readFile(id, selected!),
    enabled: Boolean(selected),
  });

  const crumbs = rel ? rel.split("/") : [];
  const iconFor = (name: string) => {
    if (/\.(js|jsx|ts|tsx|py|go|rs|java|rb|php|c|cpp|h|sh)$/.test(name)) return "⌘";
    if (/\.(json|ya?ml|toml|ini|env|lock)$/.test(name)) return "⚙";
    if (/\.(md|txt)$/.test(name)) return "≡";
    if (/\.(png|jpe?g|gif|svg|webp|ico)$/.test(name)) return "◧";
    return "•";
  };

  return (
    <div className="grid two">
      <div className="panel">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Explorador</h2>
          <div className="row" style={{ gap: "0.4rem" }}>
            <a className="ghost small button-like" href={api.projectDownloadUrl(id)} download>Descargar (.tar.gz)</a>
            <button className="ghost small" onClick={() => tree.refetch()}>Refrescar</button>
          </div>
        </div>
        <div className="row" style={{ margin: "0.6rem 0", gap: "0.2rem", flexWrap: "wrap" }}>
          <button className="ghost small" onClick={() => { setRel(""); setSelected(null); }}>raíz</button>
          {crumbs.map((c, i) => (
            <span key={i} className="row" style={{ gap: "0.2rem" }}>
              <span className="muted">/</span>
              <button className="ghost small" onClick={() => { setRel(crumbs.slice(0, i + 1).join("/")); setSelected(null); }}>{c}</button>
            </span>
          ))}
        </div>
        {tree.isLoading ? (
          <SkeletonRows rows={4} />
        ) : !tree.data?.exists ? (
          <EmptyState icon="⌂" title="Workspace no inicializado" hint="Se creará al lanzar la primera ejecución del proyecto." />
        ) : tree.data.entries.length === 0 ? (
          <EmptyState icon="∅" title="Directorio vacío" hint="Aún no hay ficheros aquí." />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {tree.data.entries.map((e) => (
              <li key={e.name}>
                {e.type === "dir" ? (
                  <button className="ghost small" style={{ width: "100%", textAlign: "left", border: "none", background: "transparent" }}
                    onClick={() => { setRel(rel ? `${rel}/${e.name}` : e.name); setSelected(null); }}>
                    <span aria-hidden>▸</span> {e.name}/
                  </button>
                ) : (
                  <button
                    className={`ghost small${selected === (rel ? `${rel}/${e.name}` : e.name) ? " selected" : ""}`}
                    style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", color: selected === (rel ? `${rel}/${e.name}` : e.name) ? "var(--accent)" : "var(--text)" }}
                    onClick={() => setSelected(rel ? `${rel}/${e.name}` : e.name)}>
                    <span aria-hidden>{iconFor(e.name)}</span> {e.name}
                    <span className="muted" style={{ float: "right" }}>{humanSize(e.size)}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel" style={{ minWidth: 0 }}>
        <h2 style={{ marginTop: 0 }}>Visor</h2>
        {!selected ? (
          <EmptyState icon="›" title="Selecciona un fichero" hint="Elige un archivo del explorador para consultar su contenido." />
        ) : file.isLoading ? (
          <SkeletonRows rows={6} />
        ) : file.isError ? (
          <div className="error-box">{(file.error as Error).message}</div>
        ) : file.data?.binary ? (
          <p className="muted">Archivo binario ({humanSize(file.data.size)}). No se puede previsualizar como texto.</p>
        ) : (
          <>
            <div className="row spread" style={{ marginBottom: "0.5rem" }}>
              <span className="muted" style={{ wordBreak: "break-all" }}>{file.data?.path}</span>
              <span className="badge">
                {humanSize(file.data?.size ?? 0)}{file.data?.truncated ? " · truncado" : ""}
              </span>
            </div>
            <pre className="log code-preview" style={{ maxHeight: "60vh" }}>{file.data?.content}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function CostBreakdown({ pid }: { pid: string }) {
  const byModel = useQuery({ queryKey: ["usage-model", pid], queryFn: () => api.usageByModel(pid) });
  const daily = useQuery({ queryKey: ["usage-daily", pid], queryFn: () => api.usageDaily(pid, 30) });
  const maxCost = Math.max(...(daily.data?.rows ?? []).map((r) => r.cost), 0.000001);
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <h3 style={{ marginBottom: "0.3rem" }}>Coste por modelo/tipo</h3>
      {byModel.data && byModel.data.rows.length > 0 ? (
        <table>
          <thead><tr><th>Modelo</th><th>Tipo</th><th>Tokens</th><th>Coste</th><th>%</th></tr></thead>
          <tbody>
            {byModel.data.rows.map((r, i) => (
              <tr key={i}>
                <td>{r.modelId?.slice(0, 24) ?? "—"}</td>
                <td className="muted">{r.kind}</td>
                <td>{(r.inputTokens + r.outputTokens).toLocaleString()}</td>
                <td>${r.cost.toFixed(4)}</td>
                <td className="muted">{Math.round(r.pct * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">Sin registros de coste todavía.</p>}
      <h3 style={{ marginBottom: "0.3rem" }}>Últimos 30 días</h3>
      <div className="row" style={{ gap: "2px", alignItems: "flex-end", height: 48 }}>
        {(daily.data?.rows ?? []).map((r) => (
          <div key={r.day} title={`${r.day}: $${r.cost.toFixed(4)}`} style={{ width: 10, background: "var(--accent)", height: `${Math.max(4, (r.cost / maxCost) * 100)}%`, borderRadius: 2 }} />
        ))}
        {(daily.data?.rows ?? []).length === 0 && <span className="muted">Sin datos.</span>}
      </div>
    </div>
  );
}
