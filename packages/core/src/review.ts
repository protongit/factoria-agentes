import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ReviewVerdictKind = "approved" | "rejected";

export interface ReviewVerdict {
  verdict: ReviewVerdictKind;
  reviewerModelId?: string;
  reviewerFamily?: string;
  authorModelId?: string;
  diffHash: string;
  summary?: string;
  confidence?: number;
  workspace: string;
  arbitrated?: boolean;
  createdAt?: string;
}

/** Familia de un modelo: prefijo antes de `/` y antes del primer separador. */
export function modelFamily(modelId: string): string {
  const raw = modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;
  const head = raw.split(/[-_.:]/)[0] ?? raw;
  return head.toLowerCase();
}

/** Hash sha256 del diff normalizado (sin CR, sin espacios finales). */
export function hashDiff(diff: string): string {
  const normalized = `${diff.replace(/\r\n/g, "\n").replace(/\s+$/, "")}\n`;
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Selecciona un modelo revisor de familia distinta al autor (principio de
 * Karajan: el revisor nunca es el autor). Devuelve `undefined` si no hay candidatos.
 */
export function selectReviewModel(
  authorModelId: string | null | undefined,
  candidates: string[],
): string | undefined {
  if (candidates.length === 0) return undefined;
  const authorFamily = authorModelId ? modelFamily(authorModelId) : null;
  const distinct = candidates.filter((c) => !authorFamily || modelFamily(c) !== authorFamily);
  return distinct[0] ?? undefined;
}

/** ¿Existe un veredicto aprobado para el hash exacto del diff? */
export function approveFor(stored: ReviewVerdict | undefined, diffHash: string): boolean {
  return Boolean(stored && stored.diffHash === diffHash && stored.verdict === "approved");
}

export interface VerdictStore {
  save(verdict: ReviewVerdict): Promise<void>;
  get(diffHash: string): Promise<ReviewVerdict | undefined>;
}

/** Store de veredictos en disco: `.factoria/reviews/<sha256>.json`. */
export function fileVerdictStore(workspace: string): VerdictStore {
  const dir = path.join(workspace, ".factoria", "reviews");
  const file = (hash: string) => path.join(dir, `${hash}.json`);
  return {
    async save(verdict) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(verdict.diffHash), JSON.stringify(verdict, null, 2), { mode: 0o644 });
    },
    async get(diffHash) {
      const p = file(diffHash);
      if (!existsSync(p)) return undefined;
      try {
        return JSON.parse(readFileSync(p, "utf8")) as ReviewVerdict;
      } catch {
        return undefined;
      }
    },
  };
}

/** Store en memoria (tests). */
export function memoryVerdictStore(): VerdictStore {
  const map = new Map<string, ReviewVerdict>();
  return {
    async save(verdict) {
      map.set(verdict.diffHash, verdict);
    },
    async get(diffHash) {
      return map.get(diffHash);
    },
  };
}
