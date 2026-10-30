import { describe, expect, it } from "vitest";
import { upsertWorkflowSchema } from "@factoria/shared";
import { SYSTEM_TEMPLATES } from "./templates.ts";

describe("SYSTEM_TEMPLATES", () => {
  it("todas las plantillas son válidas según el esquema de flujo", () => {
    for (const tpl of SYSTEM_TEMPLATES) {
      const parsed = upsertWorkflowSchema.safeParse(tpl);
      expect(parsed.success, `plantilla inválida: ${tpl.name} ${parsed.success ? "" : JSON.stringify(parsed.error.flatten())}`).toBe(true);
    }
  });

  it("incluye los seis pipelines de Karajan", () => {
    const karajan = SYSTEM_TEMPLATES.filter((t) => t.category === "karajan");
    expect(karajan.length).toBe(6);
  });

  it("no tiene nodos/aristas colgantes (toda arista referencia un nodo)", () => {
    for (const tpl of SYSTEM_TEMPLATES) {
      const keys = new Set(tpl.nodes.map((n) => (n as { key: string }).key));
      for (const edge of tpl.edges) {
        const e = edge as { fromNodeKey: string; toNodeKey: string };
        expect(keys.has(e.fromNodeKey), `${tpl.name}: origen desconocido ${e.fromNodeKey}`).toBe(true);
        expect(keys.has(e.toNodeKey), `${tpl.name}: destino desconocido ${e.toNodeKey}`).toBe(true);
      }
    }
  });
});
