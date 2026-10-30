import type { PolicyClass } from "@factoria/shared";
import type { PolicyRule } from "./policy.ts";

export interface RuleSource {
  id: string;
  source: string;
  text: string;
}

const RULE_RE = /^\s*(?:[-*]|\d+\.)\s+(.*\S)\s*$/;

/** Extrae reglas candidatas de un documento Markdown (viñetas en secciones de reglas). */
export function extractRulesFromMarkdown(markdown: string, source: string): RuleSource[] {
  const rules: RuleSource[] = [];
  let index = 0;
  for (const line of markdown.split("\n")) {
    const match = RULE_RE.exec(line);
    if (!match || !match[1]) continue;
    const text = match[1];
    if (!/(no |nunca|siempre|debe|deben|prohib|obligat|usa |evita|never|always|must|do not|don't)/i.test(text)) continue;
    index += 1;
    rules.push({ id: `${slug(source)}-${index}`, source, text });
  }
  return rules;
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/\.[a-z]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Esqueleto de compilación: cada regla queda como `none` (sin gate) a la espera
 * de que un humano decida su tipo/condición. No llama a ningún modelo.
 */
export function compileRuleSkeleton(rules: RuleSource[]): PolicyRule[] {
  return rules.map((r) => ({
    id: r.id,
    source: r.source,
    literalText: r.text,
    kind: "none" as const,
    klass: "process" as PolicyClass,
  }));
}

export interface RuleCoverage {
  noGate: string[];
  stale: string[];
}

/**
 * Cobertura: qué reglas del MD no tienen gate y cuáles quedaron obsoletas
 * (su texto ya no aparece en el MD).
 */
export function ruleCoverage(markdownBySource: Record<string, string>, compiled: PolicyRule[]): RuleCoverage {
  const noGate: string[] = [];
  const stale: string[] = [];
  for (const rule of compiled) {
    if (rule.kind !== "deterministic" || !rule.condition) noGate.push(rule.id);
    const md = markdownBySource[rule.source];
    if (md !== undefined && !md.includes(rule.literalText)) stale.push(rule.id);
  }
  return { noGate, stale };
}

/** Reglas deterministas listas para evaluar en el Sentinel. */
export function activeRules(compiled: PolicyRule[]): PolicyRule[] {
  return compiled.filter((r) => r.kind === "deterministic" && r.condition);
}
