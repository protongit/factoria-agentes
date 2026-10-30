import type { JoinPolicy, NodeType, StepStatus } from "@factoria/shared";

export interface GraphNode {
  key: string;
  type: NodeType;
  joinPolicy?: JoinPolicy;
  loopGuard?: { maxIterations: number } | null;
}

export interface GraphEdge {
  fromNodeKey: string;
  toNodeKey: string;
  condition?: Record<string, unknown> | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function nodeMap(graph: Graph): Map<string, GraphNode> {
  return new Map(graph.nodes.map((node) => [node.key, node]));
}

export function successors(graph: Graph, key: string): string[] {
  return graph.edges.filter((e) => e.fromNodeKey === key).map((e) => e.toNodeKey);
}

export function predecessors(graph: Graph, key: string): string[] {
  return graph.edges.filter((e) => e.toNodeKey === key).map((e) => e.fromNodeKey);
}

export function roots(graph: Graph): string[] {
  const map = nodeMap(graph);
  return graph.nodes
    .filter((node) => node.type === "start" || predecessors(graph, node.key).length === 0)
    .map((node) => node.key)
    .filter((key) => map.get(key)?.type !== "end");
}

export type StatusResolver = (nodeKey: string) => StepStatus;

/**
 * Determina los nodos que pueden ejecutarse dados los estados actuales de los
 * pasos. Un nodo es `ready` si todos sus predecesores cumplen la política de
 * join (all/any) y él mismo no está ya en curso ni terminado.
 */
export function computeReadyNodes(graph: Graph, statusOf: StatusResolver): string[] {
  const map = nodeMap(graph);
  const ready: string[] = [];

  for (const node of graph.nodes) {
    const status = statusOf(node.key);
    if (status === "running" || status === "succeeded" || status === "waiting_approval") continue;
    if (node.type === "start" || node.type === "end") continue;

    const preds = predecessors(graph, node.key);
    if (preds.length === 0) {
      ready.push(node.key);
      continue;
    }

    const predStatuses = preds.map(statusOf);
    const policy: JoinPolicy = map.get(node.key)?.joinPolicy ?? "all";
    const ok =
      policy === "all"
        ? predStatuses.every((s) => s === "succeeded")
        : predStatuses.some((s) => s === "succeeded");

    if (ok) ready.push(node.key);
  }

  return ready;
}

/** Tareas independientes que pueden correr en paralelo (fan-out). */
export function parallelizable(graph: Graph, statusOf: StatusResolver): string[] {
  const ready = computeReadyNodes(graph, statusOf);
  const usedDirs = new Set<string>();
  const result: string[] = [];
  for (const key of ready) {
    // El aislamiento por workingDir se resuelve aguas arriba en el scheduler;
    // aquí sólo agrupamos las que ya están listas.
    if (usedDirs.has(key)) continue;
    usedDirs.add(key);
    result.push(key);
  }
  return result;
}
