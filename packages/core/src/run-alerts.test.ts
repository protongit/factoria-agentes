import { describe, expect, it } from "vitest";
import { buildRunBriefing, runAlertMessage, runAlertNextSteps } from "./run-alerts.ts";

describe("runAlertMessage", () => {
  it("describe una validación pendiente con el nombre del paso", () => {
    expect(runAlertMessage({ projectName: "Zeldo", kind: "approval", nodeName: "Validar entrega" })).toContain(
      "«Validar entrega»",
    );
  });

  it("incluye el motivo cuando un paso falla", () => {
    expect(runAlertMessage({ projectName: "Zeldo", kind: "failed", nodeName: "Implementar", reason: "fetch failed" })).toBe(
      "La ejecución falló en el paso «Implementar»: fetch failed",
    );
  });

  it("avisa de contratos pendientes al terminar", () => {
    expect(runAlertMessage({ projectName: "Zeldo", kind: "succeeded", contractsOk: false })).toContain("contratos pendientes");
  });
});

describe("runAlertNextSteps", () => {
  it("propone aprobar o rechazar en las validaciones humanas", () => {
    const steps = runAlertNextSteps({ projectName: "Zeldo", kind: "approval", nodeName: "Revisión" });
    expect(steps.join(" ")).toContain("Aprobar");
    expect(steps.join(" ")).toContain("Rechazar");
  });

  it("propone reejecutar desde el paso fallido", () => {
    const steps = runAlertNextSteps({ projectName: "Zeldo", kind: "failed", nodeName: "Implementar" });
    expect(steps.join(" ")).toContain("Reejecutar desde «Implementar»");
  });
});

describe("buildRunBriefing", () => {
  it("incluye situación y pasos siguientes numerados", () => {
    const text = buildRunBriefing({
      projectName: "Zeldo",
      kind: "failed",
      nodeName: "Implementar",
      reason: "fetch failed",
    });
    expect(text).toContain("La ejecución ha fallado — Zeldo.");
    expect(text).toContain("Motivo: fetch failed");
    expect(text).toContain("1. ");
    expect(text).toContain("2. ");
  });
});
