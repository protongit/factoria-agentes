import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useMemo } from "react";
import type { WorkflowEdgeRow, WorkflowNodeRow } from "../lib/api.ts";

const COLORS: Record<string, string> = {
  start: "#34d399", end: "#f87171", task: "#4f8cff", gate: "#a06bff", join: "#2dd4bf",
  orchestrator: "#7c8cf8", condition: "#f0b429", loop: "#fb923c", subworkflow: "#22d3ee",
  human_approval: "#f472b6", contract_check: "#34d399", push_repo: "#94a3b8",
  documentation: "#9ca3af", notify: "#facc15",
};

const STATUS_COLOR: Record<string, string> = {
  running: "#4f8cff",
  succeeded: "#35c07f",
  failed: "#ff6b6b",
  waiting_approval: "#f0b429",
};

const PENDING_COLOR = "#64748b";
const REPEAT_COLOR = "#fb923c";

interface WfData extends Record<string, unknown> {
  label: string;
  type: string;
  status?: string;
  iterations?: number;
}

function FlowNode({ data }: NodeProps) {
  const d = data as WfData;
  const hasStatus = Boolean(d.status);
  const repeated = (d.iterations ?? 0) > 1;
  const color = !hasStatus
    ? PENDING_COLOR
    : repeated
      ? REPEAT_COLOR
      : STATUS_COLOR[d.status!] ?? COLORS[d.type] ?? "#4f8cff";
  const isRunning = d.status === "running";
  return (
    <div
      className="wf-node"
      style={{
        borderLeftColor: color,
        minWidth: 150,
        opacity: hasStatus ? 1 : 0.55,
        boxShadow: isRunning ? `0 0 0 3px ${color}, 0 0 18px ${color}66` : undefined,
        animation: isRunning ? "pulse-node 1.2s infinite" : undefined,
      }}
    >
      {repeated && <span className="wf-iter-badge" style={{ background: REPEAT_COLOR }}>×{d.iterations}</span>}
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <div className="wf-node-head">
        <span className="wf-node-mark" style={{ background: color }}>◆</span>
        <span className="wf-node-title">{d.label}</span>
      </div>
      <div className="wf-node-body">
        <span className="wf-node-type" style={{ color: hasStatus ? color : PENDING_COLOR, borderColor: hasStatus ? color : PENDING_COLOR }}>{d.type}</span>
        {d.status && <span className="wf-chip">{d.status}</span>}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
}

const nodeTypes = { flow: FlowNode };

function layered(nodes: WorkflowNodeRow[], edges: WorkflowEdgeRow[]): Map<string, { x: number; y: number }> {
  const level = new Map<string, number>();
  for (const n of nodes) level.set(n.key, 0);
  for (let i = 0; i < nodes.length; i++) {
    for (const e of edges) level.set(e.toNodeKey, Math.max(level.get(e.toNodeKey) ?? 0, (level.get(e.fromNodeKey) ?? 0) + 1));
  }
  const rows = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const l = level.get(n.key) ?? 0;
    const r = rows.get(l) ?? 0;
    rows.set(l, r + 1);
    pos.set(n.key, { x: 40 + l * 270, y: 40 + r * 130 });
  }
  return pos;
}

function FlowDiagramInner({
  nodes,
  edges,
  status,
  iterations = {},
  height = "58vh",
}: {
  nodes: WorkflowNodeRow[];
  edges: WorkflowEdgeRow[];
  status: Record<string, string>;
  iterations?: Record<string, number>;
  height?: string;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nodes.length === 0) return;
    const timers = [80, 400, 1000].map((d) => window.setTimeout(() => fitView({ padding: 0.25, duration: 200 }), d));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [nodes.length, fitView]);

  const rfNodes: Node<WfData>[] = useMemo(() => {
    const needsLayout = nodes.some((n) => !n.position);
    const pos = needsLayout ? layered(nodes, edges) : null;
    return nodes.map((n) => ({
      id: n.key,
      type: "flow",
      position: n.position ?? pos?.get(n.key) ?? { x: 0, y: 0 },
      data: { label: n.name, type: n.type, status: status[n.key], iterations: iterations[n.key] ?? 0 },
    }));
  }, [nodes, edges, status]);

  const rfEdges = useMemo(
    () =>
      edges.map((e, i) => {
        const on = e.condition?.on;
        const color = on === "success" ? "#35c07f" : on === "failure" ? "#ff6b6b" : "#4a5a72";
        return {
          id: `fe${i}`,
          source: e.fromNodeKey,
          target: e.toNodeKey,
          type: "smoothstep",
          label: on === "success" ? "éxito" : on === "failure" ? "fallo" : "",
          style: { stroke: color, strokeWidth: 2 },
          markerEnd: { type: 1 as never, color },
          labelStyle: { fill: "#e6edf6", fontSize: 10 },
          labelBgStyle: { fill: "#0e1420", fillOpacity: 0.9 },
        };
      }),
    [edges],
  );

  if (nodes.length === 0) return <p className="muted">El flujo no tiene nodos.</p>;

  return (
    <div style={{ height, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        colorMode="dark"
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        panOnScroll
        zoomOnScroll
        fitView
        fitViewOptions={{ padding: 0.25, minZoom: 0.3, maxZoom: 1.4 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#243043" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function FlowDiagram(props: Parameters<typeof FlowDiagramInner>[0]) {
  return (
    <ReactFlowProvider>
      <FlowDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
