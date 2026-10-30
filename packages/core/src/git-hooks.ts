import { findAttribution } from "./attribution.ts";

/** Política de commits: Conventional Commits, longitud y sin atribución IA. */
export interface CommitPolicy {
  maxSubjectLength: number;
  types: string[];
}

export const DEFAULT_COMMIT_POLICY: CommitPolicy = {
  maxSubjectLength: 100,
  types: [
    "feat", "fix", "docs", "style", "refactor", "perf", "test", "build",
    "ci", "chore", "revert",
  ],
};

export interface CommitCheck {
  ok: boolean;
  violations: string[];
}

/** Valida el mensaje de commit contra la política del proyecto. */
export function checkCommitMessage(
  message: string,
  policy: CommitPolicy = DEFAULT_COMMIT_POLICY,
): CommitCheck {
  const violations: string[] = [];
  const firstLine = message.split("\n").find((l) => l.trim().length > 0) ?? "";

  const header = /^(\w+)(\([\w.\-/]+\))?!?:\s+(.+)$/.exec(firstLine);
  if (!header) {
    violations.push("El asunto debe seguir Conventional Commits: `tipo(alcance): descripción`.");
  } else if (!policy.types.includes(header[1] ?? "")) {
    violations.push(`Tipo de commit no permitido: «${header[1]}».`);
  } else if ((header[3] ?? "").length > policy.maxSubjectLength) {
    violations.push(`El asunto supera ${policy.maxSubjectLength} caracteres.`);
  }

  for (const finding of findAttribution(message)) {
    violations.push(`Atribución de IA detectada (${finding.pattern}): «${finding.excerpt}».`);
  }

  return { ok: violations.length === 0, violations };
}

/** Script CLI determinista que ejecutan los hooks dentro del contenedor. */
export function renderGateScript(): string {
  return `#!/usr/bin/env node
// Generado por Factoría de Agentes — no editar a mano (se regenera al preparar el workspace).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const gate = process.argv[2];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const reviewsDir = path.join(root, ".factoria", "reviews");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}

function hashDiff(diff) {
  const normalized = diff.replace(/\\r\\n/g, "\\n").replace(/\\s+$/, "") + "\\n";
  return createHash("sha256").update(normalized).digest("hex");
}

function fail(msg) {
  process.stderr.write("factoria gate: " + msg + "\\n");
  process.exit(1);
}

if (gate === "commit-msg") {
  const file = process.argv[3];
  const message = file && existsSync(file) ? readFileSync(file, "utf8") : "";
  const first = message.split("\\n").find((l) => l.trim().length > 0) || "";
  if (!/^(\\w+)(\\([\\w.\\-/]+\\))?!?:\\s+.+$/.test(first)) {
    fail("el asunto debe seguir Conventional Commits: tipo(alcance): descripción");
  }
  if (/co-authored-by:\\s*(claude|codex|copilot|gemini|cursor|ai)/i.test(message) ||
      /generated (with|by)\\s+(claude|codex|copilot|gemini|cursor|ai|gpt|chatgpt)/i.test(message) ||
      /(claude code|github copilot|cursor ai|opencode ai)/i.test(message) ||
      /ai-(generated|assisted)/i.test(message)) {
    fail("atribución de IA prohibida en el mensaje de commit");
  }
  process.exit(0);
}

if (gate === "review-check") {
  const diff = git(["diff", "--cached"]);
  if (!diff.trim()) process.exit(0);
  const attribution = diff.split("\\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).find((l) =>
    /co-authored-by:\\s*(claude|codex|copilot|gemini|cursor|ai)/i.test(l) ||
    /generated (with|by)\\s+(claude|codex|copilot|gemini|cursor|ai)/i.test(l) ||
    /(claude code|github copilot|cursor ai)/i.test(l));
  if (attribution) fail("atribución de IA detectada en el diff: " + attribution.slice(0, 80));
  const hash = hashDiff(diff);
  const verdictPath = path.join(reviewsDir, hash + ".json");
  if (!existsSync(verdictPath)) {
    fail("no hay veredicto de revisión para este diff (" + hash.slice(0, 12) + "). Ejecuta la revisión cross-AI antes de commitear.");
  }
  const verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
  if (verdict.verdict !== "approved") {
    fail("el veredicto para este diff es «" + verdict.verdict + "»: " + (verdict.summary || "sin resumen"));
  }
  process.exit(0);
}

if (gate === "pre-push") {
  // El método no puede estar rojo al empujar: exige veredicto para el diff staged/HEAD.
  try {
    const diff = git(["diff", "HEAD"]);
    if (diff.trim()) {
      const hash = hashDiff(diff);
      if (!existsSync(path.join(reviewsDir, hash + ".json"))) {
        fail("hay cambios sin veredicto de revisión; revisa antes de empujar");
      }
    }
  } catch { /* sin HEAD aún */ }
  process.exit(0);
}

if (gate === "install") {
  mkdirSync(reviewsDir, { recursive: true });
  writeFileSync(path.join(reviewsDir, ".gitkeep"), "");
  process.exit(0);
}

fail("gate desconocido: " + gate);
`;
}

function shellHook(gate: string): string {
  return `#!/bin/sh
# Generado por Factoría de Agentes.
exec node "$(git rev-parse --show-toplevel)/.factoria/bin/gate.mjs" ${gate} "$@"
`;
}

/** Ficheros de hooks y utilidades a materializar en el workspace. */
export function hookFiles(): Record<string, string> {
  return {
    ".factoria/bin/gate.mjs": renderGateScript(),
    ".factoria/hooks/pre-commit": shellHook("review-check"),
    ".factoria/hooks/commit-msg": shellHook("commit-msg"),
    ".factoria/hooks/pre-push": shellHook("pre-push"),
  };
}
