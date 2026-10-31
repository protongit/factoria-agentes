import type { Harness, PermissionMode, SubagentCategory } from "@factoria/shared";

export type PermissionValue = PermissionMode | Record<string, PermissionMode>;

export interface PermissionConfig {
  read: PermissionMode;
  edit: PermissionMode;
  bash: PermissionValue;
  webfetch: PermissionMode;
  task: PermissionValue;
  /** Acceso a rutas fuera del workspace (opencode lo pide con `external_directory`). */
  external_directory: PermissionMode;
  /** Protección contra bucles peligrosos del agente. */
  doom_loop: PermissionMode;
}

const DEFAULTS: PermissionConfig = {
  read: "allow",
  edit: "deny",
  bash: "deny",
  webfetch: "deny",
  task: "deny",
  external_directory: "deny",
  doom_loop: "deny",
};

/**
 * Combina los permisos del subagente y del harness del paso.
 * Los permisos del harness (si están definidos) tienen prioridad.
 */
export function resolvePermissions(
  subagentPermissions?: Partial<PermissionConfig> | null,
  harnessPermissions?: Partial<PermissionConfig> | null,
): PermissionConfig {
  return {
    ...DEFAULTS,
    ...(subagentPermissions ?? {}),
    ...(harnessPermissions ?? {}),
  };
}

/** Decide si un permiso está permitido según el harness (cadena o mapa de patrones). */
export function permissionAllows(configured: unknown, pattern?: string | string[]): boolean {
  if (typeof configured === "string") return configured === "allow";
  if (!configured || typeof configured !== "object") return false;
  const map = configured as Record<string, string>;
  const patterns = Array.isArray(pattern) ? pattern : pattern ? [pattern] : ["*"];
  const glob = (source: string, text: string) =>
    new RegExp(`^${source.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(text);
  for (const p of patterns) {
    for (const [key, value] of Object.entries(map)) {
      if (key === "*" || key === p || glob(key, p)) {
        if (value === "allow") return true;
        if (value === "deny") return false;
      }
    }
  }
  return false;
}

/** Materializa los permisos en el formato de agente de opencode. */
export function toOpenCodePermissions(config: PermissionConfig): Record<string, unknown> {
  return {
    read: config.read,
    edit: config.edit,
    bash: config.bash,
    webfetch: config.webfetch,
    task: config.task,
    external_directory: config.external_directory,
    doom_loop: config.doom_loop,
  };
}

export interface SubagentLike {
  name: string;
  description: string;
  instructions: string;
  category: SubagentCategory;
  defaultModelId?: string | null;
  temperature?: string | null;
  permissions?: Partial<PermissionConfig> | null;
  outputContract?: string | null;
  mcpServers?: string[] | null;
  skills?: string[] | null;
}

function contractBlock(outputContract?: string | null): string {
  const contract =
    outputContract ??
    `## Hallazgos

- Severidad:
- Evidencia:
- Fichero/línea:
- Confianza:
- Acción recomendada:

## Qué no he podido comprobar

## Siguiente paso`;
  return `\n\nDevuelve siempre tu resultado con este contrato de salida:\n\n${contract}`;
}

/** Genera el fichero `.opencode/agent/<name>.md` de un subagente. */
export function subagentToOpenCodeMarkdown(subagent: SubagentLike): string {
  const permissions = toOpenCodePermissions(resolvePermissions(subagent.permissions ?? undefined));
  const frontmatter = {
    description: subagent.description,
    mode: "subagent",
    ...(subagent.defaultModelId ? { model: subagent.defaultModelId } : {}),
    ...(subagent.temperature ? { temperature: Number(subagent.temperature) } : {}),
    permission: permissions,
  };
  return `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n${subagent.instructions}${contractBlock(subagent.outputContract)}`;
}

/** Genera el fichero `.claude/agents/<name>.md` de un subagente. */
export function subagentToClaudeMarkdown(subagent: SubagentLike): string {
  const perms = resolvePermissions(subagent.permissions ?? undefined);
  const tools = ["Read", "Grep", "Glob"];
  if (perms.edit === "allow") tools.push("Edit", "Write");
  if (perms.bash !== "deny") tools.push("Bash");
  if (perms.webfetch !== "deny") tools.push("WebFetch");
  return `---\nname: ${subagent.name}\ndescription: ${subagent.description}\ntools: ${tools.join(", ")}\n---\n\n${subagent.instructions}${contractBlock(subagent.outputContract)}`;
}

/** Genera el fichero `.codex/agents/<name>.toml` de un subagente. */
export function subagentToCodexToml(subagent: SubagentLike): string {
  const perms = resolvePermissions(subagent.permissions ?? undefined);
  const sandbox = perms.edit === "allow" ? "workspace-write" : "read-only";
  const instructions = `${subagent.instructions}${contractBlock(subagent.outputContract)}`
    .replace(/\\/g, "\\\\")
    .replace(/"""/g, '\\"\\"\\"');
  return `name = "${subagent.name}"
description = "${subagent.description}"
sandbox_mode = "${sandbox}"
developer_instructions = """
${instructions}
"""`;
}
