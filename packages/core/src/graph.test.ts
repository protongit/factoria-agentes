import { describe, expect, it } from "vitest";
import type { Graph } from "./graph.ts";
import { computeReadyNodes, predecessors, roots, successors } from "./graph.ts";
import type { StepStatus } from "@factoria/shared";

const g: Graph = {
  nodes: [
    { key: "start", type: "start" },
    { key: "backend", type: "task" },
    { key: "frontend", type: "task" },
    { key: "review", type: "gate", joinPolicy: "all" },
    { key: "push", type: "push_repo" },
    { key: "end", type: "end" },
  ],
  edges: [
    { fromNodeKey: "start", toNodeKey: "backend" },
    { fromNodeKey: "start", toNodeKey: "frontend" },
    { fromNodeKey: "backend", toNodeKey: "review" },
    { fromNodeKey: "frontend", toNodeKey: "review" },
    { fromNodeKey: "review", toNodeKey: "push" },
    { fromNodeKey: "push", toNodeKey: "end" },
  ],
};

describe("graph", () => {
  it("detecta raíces", () => {
    expect(roots(g)).toContain("start");
  });

  it("calcula sucesores y predecesores", () => {
    expect(successors(g, "start")).toEqual(["backend", "frontend"]);
    expect(predecessors(g, "review")).toEqual(["backend", "frontend"]);
  });

  it("expone backend y frontend en paralelo tras start", () => {
    const statuses: Record<string, StepStatus> = { start: "succeeded", backend: "pending", frontend: "pending" };
    const ready = computeReadyNodes(g, (k) => statuses[k] ?? "pending");
    expect(ready.sort()).toEqual(["backend", "frontend"]);
  });

  it("no libera review hasta que ambas ramas terminan (join all)", () => {
    const statuses: Record<string, StepStatus> = {
      start: "succeeded",
      backend: "succeeded",
      frontend: "running",
    };
    const ready = computeReadyNodes(g, (k) => statuses[k] ?? "pending");
    expect(ready).not.toContain("review");

    statuses.frontend = "succeeded";
    const ready2 = computeReadyNodes(g, (k) => statuses[k] ?? "pending");
    expect(ready2).toContain("review");
  });
});
