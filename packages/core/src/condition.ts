export type ConditionOperator = "contains" | "not_contains" | "equals" | "regex" | "truthy";

export interface ConditionConfig {
  field?: string;
  op?: ConditionOperator;
  value?: string;
  /** Expresión simple: "contains:texto", "equals:x", "regex:patrón", "truthy". */
  expr?: string;
  /** Enrutado por IA (lo evalúa el worker con un modelo). */
  prompt?: string;
}

export interface ConditionContext {
  text: string;
  outputs: Record<string, string>;
  verdictPassed?: boolean;
}

function parseExpr(expr: string): ConditionConfig {
  const idx = expr.indexOf(":");
  if (idx === -1) return { op: "truthy" };
  return { op: expr.slice(0, idx) as ConditionOperator, value: expr.slice(idx + 1) };
}

/** Evalúa una condición determinista contra el contexto. Devuelve undefined si requiere IA. */
export function evaluateCondition(config: ConditionConfig, ctx: ConditionContext): boolean | undefined {
  const merged: ConditionConfig = config.expr ? { ...parseExpr(config.expr), ...config } : config;
  const subject = merged.field ? (ctx.outputs[merged.field] ?? "") : ctx.text;
  switch (merged.op) {
    case "contains":
      return subject.includes(merged.value ?? "");
    case "not_contains":
      return !subject.includes(merged.value ?? "");
    case "equals":
      return subject.trim() === (merged.value ?? "").trim();
    case "regex":
      try {
        return new RegExp(merged.value ?? "").test(subject);
      } catch {
        return false;
      }
    case "truthy":
      return subject.trim().length > 0;
    default:
      return undefined;
  }
}
