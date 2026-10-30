import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Spinner, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";

const PALETTE = ["task", "gate", "review_gate", "join", "orchestrator", "condition", "loop", "subworkflow", "human_approval", "contract_check", "adr", "push_repo", "documentation", "notify", "note"];

interface NodeMeta {
  color: string;
  mark: string;
  label: string;
}

const NODE_META: Record<string, NodeMeta> = {
  start: { color: "#34d399", mark: "▶", label: "Inicio" },
  end: { color: "#f87171", mark: "■", label: "Fin" },
  task: { color: "#4f8cff", mark: "T", label: "Tarea" },
  gate: { color: "#a06bff", mark: "G", label: "Revisor" },
  join: { color: "#2dd4bf", mark: "J", label: "Join" },
  orchestrator: { color: "#7c8cf8", mark: "O", label: "Orquestador" },
  condition: { color: "#fbbf24", mark: "?", label: "Condición" },
  loop: { color: "#fb923c", mark: "↻", label: "Bucle" },
  subworkflow: { color: "#22d3ee", mark: "⇄", label: "Subflujo" },
  human_approval: { color: "#f472b6", mark: "H", label: "Aprobación humana" },
  contract_check: { color: "#34d399", mark: "C", label: "Contratos" },
  review_gate: { color: "#a06bff", mark: "✓", label: "Review gate (cross-AI)" },
  adr: { color: "#c084fc", mark: "A", label: "ADR" },
  push_repo: { color: "#94a3b8", mark: "P", label: "Push a repo" },
  documentation: { color: "#9ca3af", mark: "D", label: "Documentación" },
  note: { color: "#facc15", mark: "✎", label: "Nota" },
  notify: { color: "#facc15", mark: "N", label: "Aviso" },
};

const meta = (type: string): NodeMeta => NODE_META[type] ?? NODE_META.task!;

interface WfData extends Record<string, unknown> {
  type: string;
  name: string;
  description?: string;
  expectedResult?: string;
  workingDir?: string;
  joinPolicy?: string;
  subagentId?: string;
  subagentName?: string;
  modelId?: string;
  modelName?: string;
}

function WfNode({ data, selected }: NodeProps) {
  const d = data as WfData;
  const m = meta(d.type);
  const isStart = d.type === "start";
  const isEnd = d.type === "end";
  return (
    <div className={`wf-node${selected ? " sel" : ""}`} style={{ borderLeftColor: m.color, boxShadow: selected ? `0 0 0 2px ${m.color}, 0 8px 20px rgba(0,0,0,.5)` : undefined }}>
      {!isStart && <Handle type="target" position={Position.Left} style={{ background: m.color }} />}
      <div className="wf-node-head">
        <span className="wf-node-mark" style={{ background: m.color }}>{m.mark}</span>
        <span className="wf-node-title">{d.name || m.label}</span>
      </div>
      <div className="wf-node-body">
        <span className="wf-node-type" style={{ color: m.color, borderColor: m.color }}>{d.type}</span>
        {d.workingDir && d.workingDir !== "." && <span className="wf-chip">dir: {d.workingDir}</span>}
        {d.subagentName && <span className="wf-chip">sub: {d.subagentName}</span>}
        {d.modelName && <span className="wf-chip">{d.modelName}</span>}
        {d.description && <p className="wf-node-desc">{d.description}</p>}
      </div>
      {!isEnd && <Handle type="source" position={Position.Right} style={{ background: m.color }} />}
    </div>
  );
}

const nodeTypes = Object.fromEntries(Object.keys(NODE_META).map((t) => [t, WfNode]));

function edgeStyle(on?: string): Pick<Edge, "style" | "markerEnd" | "labelStyle" | "labelBgStyle"> {
  const color = on === "success" ? "#34d399" : on === "failure" ? "#f87171" : "#4a5a72";
  return {
    style: { stroke: color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    labelStyle: { fill: "#e6edf6", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#0e1420", fillOpacity: 0.9 },
  };
}

function detectBackEdges(nodes: Node[], edges: Edge[]): Set<string> {
  const set = new Set<string>();
  const visited = new Set<string>();
  const stack = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const dfs = (k: string) => {
    visited.add(k);
    stack.add(k);
    for (const t of adj.get(k) ?? []) {
      if (stack.has(t)) set.add(`${k}->${t}`);
      else if (!visited.has(t)) dfs(t);
    }
    stack.delete(k);
  };
  for (const n of nodes) if (!visited.has(n.id)) dfs(n.id);
  return set;
}

/** Layout en capas (izquierda→derecha) ignorando aristas de retorno. */
function autoLayout(nodes: Node[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const back = detectBackEdges(nodes, edges);
  const level = new Map<string, number>();
  for (const n of nodes) level.set(n.id, 0);
  for (let i = 0; i < nodes.length; i++) {
    for (const e of edges) {
      if (back.has(`${e.source}->${e.target}`)) continue;
      level.set(e.target, Math.max(level.get(e.target) ?? 0, (level.get(e.source) ?? 0) + 1));
    }
  }
  const rows = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const l = level.get(n.id) ?? 0;
    const row = rows.get(l) ?? 0;
    rows.set(l, row + 1);
    pos.set(n.id, { x: 40 + l * 290, y: 60 + row * 160 });
  }
  return pos;
}

export function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}

function EditorInner() {
  const { id = "" } = useParams();
  const toast = useToast();
  const wf = useQuery({ queryKey: ["workflow", id], queryFn: () => api.workflow(id) });
  const subagents = useQuery({ queryKey: ["subagents"], queryFn: api.subagents });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WfData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ runId: string; lines: string[] } | null>(null);
  const pushTimer = useRef<number | null>(null);
  const [showVariables, setShowVariables] = useState(false);
  const [versions, setVersions] = useState<{ id: string; version: number; createdAt: string }[] | null>(null);

  useEffect(() => {
    if (wf.data?.variables) setVariables(wf.data.variables);
  }, [wf.data?.variables]);

  const pushHistory = useCallback(
    (snapshot: unknown) => {
      api
        .historyPush(id, snapshot, historyCursor ?? undefined)
        .then((r) => setHistoryCursor(r.index))
        .catch(() => {});
    },
    [id, historyCursor],
  );

  useEffect(() => {
    if (!wf.data || nodes.length === 0) return;
    if (pushTimer.current) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      pushHistory({ name: wf.data?.name, description: wf.data?.description, variables, nodes, edges });
    }, 1500);
    return () => {
      if (pushTimer.current) window.clearTimeout(pushTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, variables]);

  const loadVersions = async () => {
    try {
      setVersions(await api.workflowVersions(id));
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const restore = async (version: number) => {
    try {
      await api.workflowRestore(id, version);
      await wf.refetch();
      setVersions(null);
      toast(`Restaurada v${version}`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const { fitView } = useReactFlow();

  const subagentNames = useMemo(() => new Map((subagents.data ?? []).map((s) => [s.id, s.name])), [subagents.data]);
  const modelNames = useMemo(() => new Map((models.data ?? []).map((m) => [m.id, m.displayName])), [models.data]);

  useEffect(() => {
    if (!wf.data) return;
    const rfNodes: Node<WfData>[] = wf.data.nodes.map((n, i) => ({
      id: n.key,
      type: n.type,
      position: n.position ?? { x: 80 + (i % 4) * 240, y: 90 + Math.floor(i / 4) * 170 },
      data: {
        type: n.type,
        name: n.name,
        description: n.description ?? "",
        expectedResult: n.expectedResult ?? "",
        workingDir: n.workingDir ?? ".",
        joinPolicy: n.joinPolicy ?? "all",
        subagentId: n.subagentId ?? "",
        subagentName: n.subagentId ? subagentNames.get(n.subagentId) : undefined,
        modelId: n.modelId ?? "",
        modelName: n.modelId ? modelNames.get(n.modelId) : undefined,
      },
    }));
    const rfEdges: Edge[] = wf.data.edges.map((e, i) => {
      const on = e.condition?.on ?? undefined;
      return {
        id: `e${i}`,
        source: e.fromNodeKey,
        target: e.toNodeKey,
        type: "smoothstep",
        label: on === "success" ? "éxito" : on === "failure" ? "fallo" : "",
        data: { on: on ?? "" },
        ...edgeStyle(on),
      };
    });
    if (wf.data.nodes.some((n) => !n.position)) {
      const pos = autoLayout(rfNodes, rfEdges);
      for (const n of rfNodes) {
        const p = pos.get(n.id);
        if (p) n.position = p;
      }
    }
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [wf.data, setNodes, setEdges, subagentNames, modelNames]);

  const undo = async () => {
    if (historyCursor === null) return;
    try {
      const r = await api.historyMove(id, historyCursor, -1);
      const snap = r.snapshot as { nodes: never[]; edges: never[] };
      if (snap?.nodes) { await api.saveWorkflow(id, { name: wf.data?.name ?? "Flujo", description: wf.data?.description ?? "", variables: wf.data?.variables ?? {}, nodes: snap.nodes as never, edges: snap.edges as never }); await wf.refetch(); setHistoryCursor(r.index); }
    } catch (e) { toast((e as Error).message, "err"); }
  };
  const redo = async () => {
    if (historyCursor === null) return;
    try {
      const r = await api.historyMove(id, historyCursor, +1);
      const snap = r.snapshot as { nodes: never[]; edges: never[] };
      if (snap?.nodes) { await api.saveWorkflow(id, { name: wf.data?.name ?? "Flujo", description: wf.data?.description ?? "", variables: wf.data?.variables ?? {}, nodes: snap.nodes as never, edges: snap.edges as never }); await wf.refetch(); setHistoryCursor(r.index); }
    } catch (e) { toast((e as Error).message, "err"); }
  };

  const runTest = async () => {
    if (!selectedNode) return;
    try {
      const d = selectedNode.data as Record<string, unknown>;
      const run = await api.testNode(id, {
        key: selectedNode.id, type: d.type, name: d.name,
        description: d.description, modelId: d.modelId || undefined, subagentId: d.subagentId || undefined,
        expectedResult: d.expectedResult, harness: d, workingDir: d.workingDir || ".",
      });
      setTestResult({ runId: run.id, lines: ["Prueba lanzada…"] });
      const poll = window.setInterval(async () => {
        try {
          const full = await api.run(run.id);
          const evs = await api.runEvents(run.id, 0);
          setTestResult({ runId: run.id, lines: evs.map((e) => `[${e.source}] ${e.message}`) });
          if (full.status !== "running" && full.status !== "queued") {
            window.clearInterval(poll);
            setTestResult({ runId: run.id, lines: [...evs.map((e) => `[${e.source}] ${e.message}`), `— Resultado: ${full.status} —`] });
          }
        } catch { /* ignore */ }
      }, 1500);
    } catch (e) { toast((e as Error).message, "err"); }
  };

  const exportJson = async () => {
    const data = await api.workflowExport(id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(wf.data?.name ?? "flujo").replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const applyAutoLayout = () => {
    const pos = autoLayout(nodes, edges);
    setNodes((nds) => nds.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    window.setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 50);
  };

  const onConnect = (c: Connection) =>
    setEdges((eds) => addEdge({ ...c, id: `e${Date.now()}`, type: "smoothstep", ...edgeStyle(undefined) }, eds));

  const addNode = (type: string) => {
    const key = `${type}_${Date.now().toString(36)}`;
    setNodes((nds) => [
      ...nds,
      {
        id: key,
        type,
        position: { x: 140 + Math.random() * 320, y: 120 + Math.random() * 220 },
        data: { type, name: meta(type).label, workingDir: ".", joinPolicy: "all" },
      } as Node<WfData>,
    ]);
    setSelected(key);
    setSelectedEdge(null);
  };

  const deleteSelected = () => {
    if (selected) {
      const node = nodes.find((n) => n.id === selected);
      if (node?.data.type === "start" || node?.data.type === "end") {
        toast("No puedes borrar los nodos de inicio o fin", "err");
        return;
      }
      setNodes((nds) => nds.filter((n) => n.id !== selected));
      setEdges((eds) => eds.filter((e) => e.source !== selected && e.target !== selected));
      setSelected(null);
    } else if (selectedEdge) {
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdge));
      setSelectedEdge(null);
    }
  };

  const updateSelected = (patch: Partial<WfData>) => {
    if (!selected) return;
    setNodes((nds) =>
      nds.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  };

  const updateEdgeCondition = (value: string) => {
    if (!selectedEdge) return;
    setEdges((eds) =>
      eds.map((e) =>
        e.id === selectedEdge
          ? { ...e, label: value === "success" ? "éxito" : value === "failure" ? "fallo" : "", data: { ...e.data, on: value }, ...edgeStyle(value || undefined) }
          : e,
      ),
    );
  };

  const save = useCallback(async () => {
    if (!wf.data) return;
    setSaving(true);
    try {
      await api.saveWorkflow(id, {
        name: wf.data.name ?? "Flujo",
        description: wf.data.description ?? "",
        variables,
        nodes: nodes.map((n) => ({
          key: n.id,
          type: n.data.type,
          name: n.data.name || n.data.type,
          description: n.data.description,
          expectedResult: n.data.expectedResult,
          workingDir: n.data.workingDir || ".",
          joinPolicy: n.data.joinPolicy || "all",
          subagentId: n.data.subagentId || undefined,
          modelId: n.data.modelId || undefined,
          position: n.position,
        })),
        edges: edges.map((e) => ({ fromNodeKey: e.source, toNodeKey: e.target, condition: (e.data?.on as string) ? { on: e.data?.on } : undefined })),
      });
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2000);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  }, [wf.data, nodes, edges, id, toast, variables]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && (selected || selectedEdge)) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, selected, selectedEdge]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selected), [nodes, selected]);

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="row" style={{ gap: "0.6rem" }}>
            <Link to="/workflows" className="muted" title="Volver a flujos" aria-label="Volver a flujos">←</Link>
            {wf.data?.name ?? "Flujo"}
            <span className="badge">{nodes.length} nodos · {edges.length} conexiones</span>
          </h1>
        </div>
        <div className="row">
          {savedAt && <span className="badge ok">✓ Guardado</span>}
          <button className="ghost" onClick={undo} title="Deshacer (Ctrl+Z)">↶</button>
          <button className="ghost" onClick={redo} title="Rehacer (Ctrl+Shift+Z)">↷</button>
          <button className="ghost" onClick={exportJson}>Exportar</button>
          <button className="ghost" onClick={() => setShowVariables((v) => !v)}>Variables</button>
          <button className="ghost" onClick={() => (versions ? setVersions(null) : loadVersions())}>Versiones</button>
          <button className="ghost" onClick={applyAutoLayout}>Auto-ordenar</button>
          <button onClick={save} disabled={saving}>{saving ? <Spinner /> : "Guardar"}</button>
        </div>
      </div>

      {showVariables && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Variables del flujo (JSON)</h2>
          <textarea
            className="code-preview"
            style={{ minHeight: 120, fontFamily: "ui-monospace, monospace" }}
            value={JSON.stringify(variables, null, 2)}
            onChange={(e) => {
              try { setVariables(JSON.parse(e.target.value || "{}")); } catch { /* ignorar JSON inválido temporalmente */ }
            }}
          />
          <div className="hint">Se guardan con el flujo y quedan disponibles para las tareas.</div>
        </div>
      )}

      {versions && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Versiones guardadas</h2>
          {versions.length ? (
            <table>
              <thead><tr><th>Versión</th><th>Fecha</th><th></th></tr></thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>v{v.version}</td>
                    <td className="muted">{new Date(v.createdAt).toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}><button className="ghost small" onClick={() => restore(v.version)}>Restaurar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">Aún no hay versiones además de la actual.</p>}
        </div>
      )}

      <div className="wf-layout">
        <div className="panel wf-palette">
          <h2>Nodos</h2>
          <p className="wf-palette-hint">Pulsa para añadir al lienzo. Conecta arrastrando desde los puntos laterales.</p>
          <div className="wf-palette-list">
            {PALETTE.map((t) => (
              <button key={t} className="wf-palette-item" onClick={() => addNode(t)}>
                <span className="wf-node-mark" style={{ background: meta(t).color }}>{meta(t).mark}</span>
                {meta(t).label}
              </button>
            ))}
          </div>
        </div>

        <div className="wf-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            colorMode="dark"
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_e, n) => { setSelected(n.id); setSelectedEdge(null); }}
            onEdgeClick={(_e, edge) => { setSelectedEdge(edge.id); setSelected(null); }}
            onPaneClick={() => { setSelected(null); setSelectedEdge(null); }}
            defaultEdgeOptions={{ type: "smoothstep" }}
            fitView
            fitViewOptions={{ padding: 0.3, minZoom: 0.4, maxZoom: 1.4 }}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#243043" />
            <Controls />
            <MiniMap pannable zoomable nodeColor={(n) => meta((n.data as WfData)?.type).color} maskColor="rgba(10,14,21,0.7)" />
          </ReactFlow>
          <div className="wf-legend">
            <span><i style={{ background: "#34d399" }} /> éxito</span>
            <span><i style={{ background: "#f87171" }} /> fallo</span>
            <span><i style={{ background: "#4a5a72" }} /> siempre</span>
          </div>
        </div>

        <div className="panel wf-inspector">
          <h2>Configuración</h2>
          {selectedNode ? (
            <div>
              <div className="row spread" style={{ marginBottom: "0.6rem" }}>
                <span className="badge accent" style={{ textTransform: "capitalize" }}>{meta(selectedNode.data.type).label}</span>
                {selectedNode.data.type !== "start" && selectedNode.data.type !== "end" && (
                  <button className="danger small" onClick={deleteSelected}>Borrar nodo</button>
                )}
              </div>
              <div className="field">
                <label htmlFor="wf-name">Nombre</label>
                <input id="wf-name" value={selectedNode.data.name} onChange={(e) => updateSelected({ name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="wf-type">Tipo</label>
                <select id="wf-type" value={selectedNode.data.type} onChange={(e) => updateSelected({ type: e.target.value })}>
                  {Object.keys(NODE_META).map((t) => <option key={t} value={t}>{meta(t).label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="wf-desc">Descripción (qué debe hacer)</label>
                <textarea id="wf-desc" value={selectedNode.data.description ?? ""} onChange={(e) => updateSelected({ description: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="wf-expected">Resultado esperado</label>
                <textarea id="wf-expected" value={selectedNode.data.expectedResult ?? ""} onChange={(e) => updateSelected({ expectedResult: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="wf-dir">Directorio de trabajo</label>
                <input id="wf-dir" value={selectedNode.data.workingDir ?? "."} onChange={(e) => updateSelected({ workingDir: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="wf-sub">Subagente</label>
                <select id="wf-sub" value={selectedNode.data.subagentId ?? ""} onChange={(e) => updateSelected({ subagentId: e.target.value, subagentName: subagentNames.get(e.target.value) })}>
                  <option value="">—</option>
                  {subagents.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="wf-model">Modelo</label>
                <select id="wf-model" value={selectedNode.data.modelId ?? ""} onChange={(e) => updateSelected({ modelId: e.target.value, modelName: modelNames.get(e.target.value) })}>
                  <option value="">—</option>
                  {models.data?.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="wf-join">Join</label>
                <select id="wf-join" value={selectedNode.data.joinPolicy ?? "all"} onChange={(e) => updateSelected({ joinPolicy: e.target.value })}>
                  <option value="all">all (espera a todos)</option>
                  <option value="any">any (con el primero)</option>
                </select>
              </div>
              <div className="row" style={{ gap: "1rem", marginBottom: "0.6rem" }}>
                <label className="row" style={{ gap: "0.3rem", color: "var(--text)", fontSize: "0.85rem" }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={Boolean(selectedNode.data.disabled)} onChange={(e) => updateSelected({ disabled: e.target.checked })} />
                  Deshabilitado
                </label>
                <label className="row" style={{ gap: "0.3rem", color: "var(--text)", fontSize: "0.85rem" }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={Boolean((selectedNode.data as Record<string, unknown>).continueOnFail)} onChange={(e) => updateSelected({ continueOnFail: e.target.checked })} />
                  Continuar si falla
                </label>
              </div>
              <div className="field">
                <label htmlFor="wf-dm">Mapeo de datos: {"{{ nodes.x.output }}"}, {"{{ vars.y }}"}, {"{{ project.stack }}"}</label>
                <textarea
                  id="wf-dm"
                  className="code-preview"
                  style={{ minHeight: 60, fontFamily: "ui-monospace, monospace" }}
                  value={JSON.stringify((selectedNode.data as Record<string, unknown>).dataMapping ?? {}, null, 2)}
                  onChange={(e) => {
                    try { updateSelected({ dataMapping: JSON.parse(e.target.value || "{}") }); } catch { /* JSON temporal inválido */ }
                  }}
                />
              </div>
              <button className="ghost" style={{ marginBottom: "0.75rem" }} onClick={runTest}>▶ Probar nodo</button>
              {testResult && (
                <div className="log code-preview" style={{ maxHeight: 220 }}>
                  {testResult.lines.map((l, i) => <div key={i} className="line">{l}</div>)}
                </div>
              )}
            </div>
          ) : selectedEdge ? (
            <div>
              <div className="row spread" style={{ marginBottom: "0.6rem" }}>
                <span className="badge">Conexión</span>
                <button className="danger small" onClick={deleteSelected}>Borrar conexión</button>
              </div>
              <div className="field">
                <label htmlFor="wf-cond">Condición de la conexión</label>
                <select id="wf-cond" value={(edges.find((e) => e.id === selectedEdge)?.data?.on as string) ?? ""} onChange={(e) => updateEdgeCondition(e.target.value)}>
                  <option value="">siempre</option>
                  <option value="success">en éxito</option>
                  <option value="failure">en fallo</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="wf-inspector-empty">
              <EmptyStateInline />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function EmptyStateInline() {
  return (
    <div className="empty" style={{ padding: "1.5rem 0.5rem" }}>
      <span className="empty-icon" aria-hidden="true">☰</span>
      <span className="empty-title">Nada seleccionado</span>
      <p>Selecciona un nodo o una conexión en el lienzo para configurarlo. Arrastra entre los puntos laterales para conectar.</p>
    </div>
  );
}
