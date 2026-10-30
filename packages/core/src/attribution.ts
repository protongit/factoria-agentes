/**
 * Detección de atribución de IA en commits, mensajes y PRs.
 * Determinista y sin escape: es una regla de proyecto, no una sugerencia.
 */

const ATTRIBUTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "co-authored-by", re: /co-authored-by:\s*(claude|codex|copilot|gemini|cursor|gpt|chatgpt|opencode|ai)/i },
  { name: "generated-with", re: /\bgenerated (with|by)\s+(claude|codex|copilot|gemini|cursor|ai|gpt|chatgpt)/i },
  { name: "written-by-ai", re: /\b(this (commit|pr|mr|code|change) was)\s+(authored|generated|written)\s+(by|with)\s+(an?\s+)?(ai|claude|codex|copilot|gemini)/i },
  { name: "tool-mention", re: /\b(claude code|github copilot|cursor ai|opencode ai|codex cli)\b/i },
  { name: "ai-signature", re: /🤖\s*generated|\bai-assisted\b|\bai-generated\b/i },
];

export interface AttributionFinding {
  pattern: string;
  excerpt: string;
}

/** Busca patrones de atribución de IA en un texto. */
export function findAttribution(text: string): AttributionFinding[] {
  const findings: AttributionFinding[] = [];
  for (const { name, re } of ATTRIBUTION_PATTERNS) {
    const match = text.match(re);
    if (match) findings.push({ pattern: name, excerpt: match[0].slice(0, 120) });
  }
  return findings;
}

/** Escanea sólo las líneas AÑADIDAS de un diff (no atribución en código ajeno). */
export function scanDiffAddedLines(diff: string): AttributionFinding[] {
  const findings: AttributionFinding[] = [];
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    findings.push(...findAttribution(line.slice(1)));
  }
  return findings;
}
