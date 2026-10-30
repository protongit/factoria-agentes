import type { StepStatus } from "@factoria/shared";
import { type Graph, computeReadyNodes, predecessors, successors } from "./graph.ts";

export interface StepVerdict {
  passed: boolean;
}

export interface EdgeCondition {
  on?: "success" | "failure";
}

/** Nodos sin predecesores reales (punto de entrada del grafo). */
export function initialNodes(graph: Graph): string[] {
  return graph.nodes
    .filter((n) => n.type !== "end" && predecessors(graph, n.key).length === 0)
    .map((n) => n.key);
}

/** Nodos listos para ejecutar con los estados actuales. */
export function readyNodes(graph: Graph, statusOf: (nodeKey: string) => StepStatus): string[] {
  return computeReadyNodes(graph, statusOf);
}

/**
 * Sucesores habilitados por el veredicto de un nodo: las aristas sin condición
 * siempre, y las condicionales según `on` (success/failure).
 */
export function enabledSuccessors(graph: Graph, nodeKey: string, verdict?: StepVerdict): string[] {
  const edges = graph.edges.filter((e) => e.fromNodeKey === nodeKey);
  const passed = verdict?.passed ?? true;
  const result: string[] = [];
  for (const edge of edges) {
    const condition = (edge.condition ?? {}) as EdgeCondition;
    if (!condition.on) {
      result.push(edge.toNodeKey);
      continue;
    }
    if (condition.on === "success" && passed) result.push(edge.toNodeKey);
    if (condition.on === "failure" && !passed) result.push(edge.toNodeKey);
  }
  return result;
}

/** ¿Se alcanzó algún nodo final? */
export function reachedEnd(graph: Graph, statusOf: (nodeKey: string) => StepStatus): boolean {
  const ends = graph.nodes.filter((n) => n.type === "end").map((n) => n.key);
  if (ends.length === 0) {
    const nodes = graph.nodes.filter((n) => n.type !== "start");
    return nodes.length > 0 && nodes.every((n) => statusOf(n.key) === "succeeded");
  }
  return ends.every((key) => statusOf(key) === "succeeded");
}

export { successors, predecessors };
