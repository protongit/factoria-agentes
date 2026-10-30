import type { StepStatus } from "@factoria/shared";
import { describe, expect, it } from "vitest";
import { completionGate } from "./contracts.ts";
import type { Graph } from "./graph.ts";
import { subagentToOpenCodeMarkdown } from "./harness.ts";
import { enabledSuccessors, initialNodes, reachedEnd } from "./scheduler.ts";

const graph: Graph = {
  nodes: [
    { key: "start", type: "start" },
    { key: "review", type: "gate" },
    { key: "fix", type: "task" },
    { key: "ship", type: "task" },
    { key: "end", type: "end" },
  ],
  edges: [
    { fromNodeKey: "start", toNodeKey: "review" },
    { fromNodeKey: "review", toNodeKey: "fix", condition: { on: "failure" } },
    { fromNodeKey: "review", toNodeKey: "ship", condition: { on: "success" } },
    { fromNodeKey: "ship", toNodeKey: "end" },
  ],
};

describe("scheduler", () => {
  it("identifica nodos iniciales", () => {
    expect(initialNodes(graph)).toContain("start");
  });

  it("habilita solo la rama de éxito cuando el veredicto pasa", () => {
    expect(enabledSuccessors(graph, "review", { passed: true })).toEqual(["ship"]);
  });

  it("habilita solo la rama de fallo cuando el veredicto no pasa", () => {
    expect(enabledSuccessors(graph, "review", { passed: false })).toEqual(["fix"]);
  });

  it("detecta el final del grafo", () => {
    const status: Record<string, StepStatus> = { end: "succeeded" };
    expect(reachedEnd(graph, (k) => status[k] ?? "pending")).toBe(true);
  });
});

describe("contracts", () => {
  it("bloquea la finalización con contratos pendientes", () => {
    const gate = completionGate([{ status: "satisfied" }, { status: "pending" }]);
    expect(gate.canComplete).toBe(false);
    expect(gate.pending).toBe(1);
  });
  it("permite finalizar con todos satisfechos", () => {
    expect(completionGate([{ status: "satisfied" }]).canComplete).toBe(true);
  });
});

describe("harness", () => {
  it("genera el fichero de subagente de opencode con permisos mínimos", () => {
    const md = subagentToOpenCodeMarkdown({
      name: "revisor",
      description: "Revisa el diff",
      instructions: "Nunca edites ficheros.",
      category: "read",
      permissions: { edit: "deny", bash: { "*": "ask", "git diff": "allow" } },
    });
    expect(md).toContain('"mode": "subagent"');
    expect(md).toContain('"edit": "deny"');
    expect(md).toContain("Nunca edites ficheros.");
  });
});
