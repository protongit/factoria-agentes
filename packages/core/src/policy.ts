import type { PolicyClass, RuleKind, GateKind } from "@factoria/shared";

/** Llamada a herramienta del agente (normalizada entre ejecutores). */
export interface ToolCall {
  tool: string;
  command?: string;
  path?: string;
  args?: Record<string, unknown>;
}

export interface PolicyRule {
  id: string;
  source: string;
  literalText: string;
  kind: RuleKind | "none";
  klass: PolicyClass;
  gate?: GateKind;
  condition?: {
    tool?: string;
    contains?: string;
    regex?: string;
    pathPrefix?: string;
    forbidden?: boolean;
  };
}

export type PolicyDecision = "allow" | "deny";

export interface RuleMatch {
  ruleId: string;
  reason: string;
  klass: PolicyClass;
}

export interface PolicyResult {
  decision: PolicyDecision;
  match?: RuleMatch;
}

/** Evalúa una llamada contra el conjunto de reglas. La primera coincidencia manda. */
export function evaluatePolicy(call: ToolCall, rules: PolicyRule[]): PolicyResult {
  for (const rule of rules) {
    if (rule.kind !== "deterministic" || !rule.condition) continue;
    const c = rule.condition;
    if (c.tool && c.tool !== call.tool) continue;

    const haystack = call.command ?? call.path ?? JSON.stringify(call.args ?? {});
    let hit = false;
    if (c.contains) hit = haystack.includes(c.contains);
    else if (c.regex) {
      try {
        hit = new RegExp(c.regex).test(haystack);
      } catch {
        hit = false;
      }
    } else if (c.pathPrefix) hit = Boolean(call.path?.startsWith(c.pathPrefix));
    else hit = true;

    if (hit) {
      return {
        decision: "deny",
        match: { ruleId: rule.id, reason: rule.literalText, klass: rule.klass },
      };
    }
  }
  return { decision: "allow" };
}

/**
 * Parser mínimo de `policy.yml`/`rules.yml` (subconjunto usado por la plataforma).
 * Acepta también JSON (si el texto empieza por `[` o `{`).
 * Formato soportado:
 *   - id: no-force-push
 *     source: AGENTS.md
 *     text: "No usar git push --force"
 *     kind: deterministic
 *     class: security
 *     gate: bash-write
 *     tool: bash
 *     contains: "git push --force"
 */
export function parsePolicy(text: string): PolicyRule[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      const list = Array.isArray(data) ? data : data.rules;
      return Array.isArray(list) ? list.map(normalizeRule) : [];
    } catch {
      return [];
    }
  }

  const rules: PolicyRule[] = [];
  let current: Record<string, string> | null = null;
  const flush = () => {
    if (current && current.id) rules.push(normalizeRule(current));
    current = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item) {
      flush();
      current = {};
      if (item[1]?.includes(":")) assign(current, item[1]);
      continue;
    }
    if (current && line.trim()) assign(current, line.trim());
  }
  flush();
  return rules;
}

function assign(target: Record<string, string>, fragment: string): void {
  const idx = fragment.indexOf(":");
  if (idx === -1) return;
  const key = fragment.slice(0, idx).trim();
  let value = fragment.slice(idx + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  target[key] = value;
}

function normalizeRule(obj: unknown): PolicyRule {
  const o = obj as Record<string, unknown>;
  const kind = (o.kind as PolicyRule["kind"]) ?? "none";
  const klass = (o.klass ?? o.class ?? "process") as PolicyClass;
  const condition: PolicyRule["condition"] = {};
  for (const key of ["tool", "contains", "regex", "pathPrefix"] as const) {
    if (typeof o[key] === "string") condition[key] = o[key] as string;
  }
  return {
    id: String(o.id ?? ""),
    source: String(o.source ?? "policy.yml"),
    literalText: String(o.text ?? o.literalText ?? ""),
    kind,
    klass,
    gate: (o.gate as GateKind | undefined) ?? undefined,
    condition: Object.keys(condition).length ? condition : undefined,
  };
}
