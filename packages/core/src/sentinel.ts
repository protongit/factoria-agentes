import type { GateKind } from "@factoria/shared";
import type { PolicyRule, ToolCall } from "./policy.ts";
import { evaluatePolicy } from "./policy.ts";
import { findAttribution } from "./attribution.ts";

export interface SentinelContext {
  workspace: string;
  lane?: string;
  hasCard: boolean;
  /** Directorios sobre los que la sesión ha consultado el RAG. */
  ragZones: string[];
  /** ¿La sesión ha consultado el RAG al menos una vez? */
  ragQueried: boolean;
  /** Ficheros que la sesión posee (creados o limpios al tocarlos). */
  sessionOwnedFiles: string[];
}

export interface SentinelViolation {
  gate: GateKind;
  reason: string;
  remedy: string;
}

const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit", "str_replace", "create_file", "apply_patch"]);
const BASH_TOOLS = new Set(["bash", "shell", "run", "terminal", "execute", "exec"]);

export function normalizeTool(tool: string): "write" | "bash" | "read" | "other" {
  const t = tool.toLowerCase();
  if (WRITE_TOOLS.has(t)) return "write";
  if (BASH_TOOLS.has(t)) return "bash";
  if (["read", "grep", "glob", "view", "list"].includes(t)) return "read";
  return "other";
}

/** Rutas de gobierno que una sesión nunca puede editar. */
const GOVERNED_PATTERNS = [
  ".factoria/policy.yml",
  ".factoria/policy.json",
  ".factoria/rules.yml",
  ".factoria/rules.local.yml",
  ".karajan/",
  "agents.md",
  "claude.md",
  ".git/hooks/",
];

function isGoverned(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  return GOVERNED_PATTERNS.some((g) => p === g || p.endsWith(`/${g}`) || p.includes(g));
}

const WRITE_COMMAND_RE =
  /(^|\s)(sed\s+-i|perl\s+-i|tee\b|truncate\b|touch\b|install\b|dd\s+of=|cp\b|mv\b|ln\b)|(^|[^>])>>?\s*[^\s&|]+|\bnode\s+-e[^\n]*?(writeFile|createWriteStream|fs\.(write|rm|unlink|rename))|\bpython3?\s+-c[^\n]*?(open\([^\n]*['"]w|shutil\.|os\.remove|os\.rmdir)/;

/** ¿El comando bash escribe ficheros dentro del repo? */
export function bashWriteViolation(command: string): SentinelViolation | undefined {
  if (!WRITE_COMMAND_RE.test(command)) return undefined;
  // Escribir fuera del repo (/tmp, /dev/null) está permitido.
  const outsideOnly = /(?:\/tmp\/|\/dev\/null|\/dev\/stdout|\/dev\/stderr)/.test(command);
  const hasRedirect = /(^|[^>])>>?\s*[^\s&|]+/.test(command);
  if (outsideOnly && !/\b(sed\s+-i|perl\s+-i|tee\b|cp\b|mv\b|dd\s+of=)/.test(command) && hasRedirect) {
    return undefined;
  }
  return {
    gate: "bash-write",
    reason: `El comando escribe ficheros del repo por Bash: «${command.slice(0, 120)}».`,
    remedy: "Usa las herramientas de edición (Edit/Write) para modificar ficheros del repositorio.",
  };
}

export function discardViolation(command: string): SentinelViolation | undefined {
  const patterns: RegExp[] = [
    /git\s+checkout\s+--\s/,
    /git\s+checkout\s+\.(\s|$)/,
    /git\s+checkout\s+-f\b/,
    /git\s+restore\b/,
    /git\s+reset\s+--hard\b/,
    /git\s+switch\s+--discard-changes\b/,
    /git\s+clean\s+(?!-n)/,
    /git\s+stash\s+(drop|clear)\b/,
  ];
  if (patterns.some((re) => re.test(command))) {
    return {
      gate: "discard",
      reason: `Comando destructivo bloqueado: «${command.slice(0, 120)}».`,
      remedy: "Usa `git stash push -- <ficheros>` para apartar cambios sin perder nada.",
    };
  }
  return undefined;
}

export function commitGateViolation(command: string): SentinelViolation | undefined {
  const noVerify = /git\s+commit[^\n]*(--no-ver|--no-verify|\s-n\b|\s-[a-z]*n[a-z]*\b)/.test(command);
  const hooksPath = /core\.hooksPath|(^|\s)-c\s+.*hooksPath/.test(command);
  if (noVerify || hooksPath) {
    return {
      gate: "commit-gate",
      reason: "Intento de saltar los hooks de git (--no-verify / core.hooksPath).",
      remedy: "Corrige el problema que bloquea el hook; no lo desactives.",
    };
  }
  return undefined;
}

function isSourceFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)(docs?|test|tests|spec|__tests__|fixtures)(\/|$)/.test(p)) return false;
  if (/\.(md|mdx|txt|json|ya?ml|toml|ini|cfg|lock)$/.test(p)) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|cs|php|c|cc|cpp|h|hpp|swift|sh)$/.test(p);
}

function underAnyDir(filePath: string, dirs: string[]): boolean {
  const p = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return dirs.some((d) => {
    const dir = d.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    return dir === "" || dir === "." || p.startsWith(`${dir}/`) || p === dir;
  });
}

/**
 * Evalúa una llamada a herramienta contra los gates habilitados.
 * Devuelve la primera violación encontrada, o `undefined` si la llamada pasa.
 */
export function evaluateToolCall(
  call: ToolCall,
  ctx: SentinelContext,
  enabled: GateKind[],
  rules: PolicyRule[] = [],
): SentinelViolation | undefined {
  const kind = normalizeTool(call.tool);
  const command = call.command ?? "";
  const gates = new Set(enabled);

  // Reglas del proyecto (policy.yml / rules.yml compiladas).
  const policy = evaluatePolicy(call, rules);
  if (policy.decision === "deny" && policy.match) {
    return {
      gate: "governance",
      reason: `Regla «${policy.match.ruleId}» (${policy.match.klass}): ${policy.match.reason}`,
      remedy: "Ajusta tu acción a la regla; si crees que está mal, propón el cambio al usuario.",
    };
  }

  // Gobernanza: nunca editar ficheros de política/reglas.
  if (kind === "write" && call.path && isGoverned(call.path)) {
    return {
      gate: "governance",
      reason: `Intento de editar un fichero de gobierno: ${call.path}.`,
      remedy: "Solo el usuario puede modificar la política; propón el cambio en vez de aplicarlo.",
    };
  }

  if (kind === "bash") {
    if (gates.has("commit-gate")) {
      const v = commitGateViolation(command);
      if (v) return v;
    }
    if (gates.has("discard")) {
      const v = discardViolation(command);
      if (v) return v;
    }
    if (gates.has("bash-write")) {
      const v = bashWriteViolation(command);
      if (v) return v;
    }
    if (gates.has("attribution")) {
      const findings = findAttribution(command);
      if (findings.length || /git\s+commit[^\n]*(-m|--message)[^\n]*co-authored-by/i.test(command)) {
        return {
          gate: "attribution",
          reason: "El comando introduce atribución de IA.",
          remedy: "Elimina cualquier mención de atribución a IA.",
        };
      }
    }
  }

  if (kind === "write" && call.path) {
    if (gates.has("cross-lane") && ctx.lane && !call.path.startsWith(ctx.lane) && !isGoverned(call.path)) {
      return {
        gate: "cross-lane",
        reason: `Escritura fuera del lane de la sesión (${ctx.lane}): ${call.path}.`,
        remedy: "Cada sesión modifica solo su propio worktree.",
      };
    }
    if (isSourceFile(call.path)) {
      if (gates.has("card-first") && !ctx.hasCard) {
        return {
          gate: "card-first",
          reason: "Se intenta editar código sin una tarjeta de trabajo asociada.",
          remedy: "Crea/mueve una tarjeta del tablero antes de tocar código.",
        };
      }
      if (gates.has("rag-first") && ctx.ragQueried && !underAnyDir(call.path, ctx.ragZones)) {
        return {
          gate: "rag-first",
          reason: `El RAG no ha respondido sobre la zona de ${call.path}.`,
          remedy: "Consulta el RAG (`kj rag query`) sobre esta zona antes de editarla.",
        };
      }
    }
  }

  return undefined;
}
