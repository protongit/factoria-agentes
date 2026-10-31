export type RunAlertKind = "approval" | "failed" | "succeeded" | "cancelled";

export interface RunAlertContext {
  projectName: string;
  kind: RunAlertKind;
  nodeName?: string | null;
  nodeKey?: string | null;
  reason?: string | null;
  contractsOk?: boolean;
}

export const RUN_ALERT_TITLES: Record<RunAlertKind, string> = {
  approval: "Validación pendiente",
  failed: "La ejecución ha fallado",
  succeeded: "La ejecución ha terminado",
  cancelled: "La ejecución se ha cancelado",
};

/** Resumen corto para la notificación y el listado de avisos. */
export function runAlertMessage(ctx: RunAlertContext): string {
  const step = ctx.nodeName ?? ctx.nodeKey;
  if (ctx.kind === "approval") {
    return step
      ? `El flujo está esperando tu validación en el paso «${step}».`
      : "El flujo está esperando tu validación.";
  }
  if (ctx.kind === "failed") {
    const where = step ? ` en el paso «${step}»` : "";
    return ctx.reason
      ? `La ejecución falló${where}: ${ctx.reason}`
      : `La ejecución falló${where}.`;
  }
  if (ctx.kind === "cancelled") return "La ejecución se canceló.";
  return ctx.contractsOk === false
    ? "La ejecución terminó, pero quedan contratos pendientes."
    : "La ejecución terminó correctamente.";
}

/** Pasos siguientes que el asistente propone al usuario. */
export function runAlertNextSteps(ctx: RunAlertContext): string[] {
  const step = ctx.nodeName ?? ctx.nodeKey;
  if (ctx.kind === "approval") {
    return [
      `Abre la pestaña Ejecuciones y revisa el paso «${step ?? "pendiente"}».`,
      "Pulsa «Aprobar» si el trabajo es correcto o «Rechazar» si necesita correcciones.",
      "El flujo se reanudará automáticamente en cuanto tomes la decisión.",
    ];
  }
  if (ctx.kind === "failed") {
    return [
      "Revisa el motivo completo en la pestaña Ejecuciones.",
      step
        ? `Corrige lo necesario y pulsa «Reejecutar desde «${step}»».`
        : "Corrige lo necesario y vuelve a lanzar la ejecución.",
      "Si el error es de red o del proveedor, prueba la conexión en «Proveedores y modelos» y vuelve a intentarlo.",
    ];
  }
  if (ctx.kind === "cancelled") {
    return [
      "Revisa los pasos que llegaron a completarse en la pestaña Ejecuciones.",
      "Lanza una nueva ejecución cuando quieras continuar.",
    ];
  }
  return [
    "Revisa los contratos y el resultado en la pestaña Ejecuciones.",
    ctx.contractsOk === false
      ? "Hay contratos pendientes: corrige lo que falte y lanza una nueva ejecución."
      : "Puedes descargar el proyecto desde la pestaña Archivos o lanzar una nueva iteración.",
  ];
}

/** Mensaje que el asistente deja en el proyecto al ocurrir el aviso. */
export function buildRunBriefing(ctx: RunAlertContext): string {
  const icon = ctx.kind === "failed" ? "✕" : ctx.kind === "succeeded" ? "✓" : ctx.kind === "approval" ? "⏸" : "■";
  const lines = [`${icon} ${RUN_ALERT_TITLES[ctx.kind]} — ${ctx.projectName}.`];
  if (ctx.nodeName || ctx.nodeKey) lines.push(`Paso: «${ctx.nodeName ?? ctx.nodeKey}».`);
  if (ctx.reason) lines.push(`Motivo: ${ctx.reason}`);
  lines.push("", "Pasos siguientes:");
  runAlertNextSteps(ctx).forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  return lines.join("\n");
}
