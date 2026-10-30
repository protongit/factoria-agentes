import { createHash } from "node:crypto";
import type { DecisionOutcome, GateKind, PolicyClass } from "@factoria/shared";

export type LedgerGate = GateKind | "review" | "claims" | "steward" | "release";

export interface LedgerInput {
  gate: LedgerGate;
  outcome: DecisionOutcome;
  reason: string;
  ruleId?: string;
  klass?: PolicyClass;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

export interface LedgerEntry extends LedgerInput {
  seq: number;
  prevHash?: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

/** Serialización canónica: ordena las claves recursivamente (jsonb de Postgres las reordena). */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

/** Hash encadenado: sha256 sobre el contenido canónico + el hash anterior. */
export function ledgerHash(entry: Omit<LedgerEntry, "hash">): string {
  const canonicalBody = canonical({
    seq: entry.seq,
    gate: entry.gate,
    outcome: entry.outcome,
    ruleId: entry.ruleId ?? null,
    klass: entry.klass ?? null,
    reason: entry.reason,
    payload: entry.payload ?? null,
    createdAt: entry.createdAt ?? null,
    prevHash: entry.prevHash ?? null,
  });
  return createHash("sha256").update(canonicalBody).digest("hex");
}

/** Añade una entrada al ledger (append-only), encadenándola a la anterior. */
export function appendEntry(entries: LedgerEntry[], input: LedgerInput): LedgerEntry {
  const prev = entries[entries.length - 1];
  const base: Omit<LedgerEntry, "hash"> = {
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
    seq: entries.length + 1,
    prevHash: prev?.hash ?? GENESIS,
  };
  return { ...base, hash: ledgerHash(base) };
}

export interface ChainCheck {
  ok: boolean;
  brokenAt?: number;
}

/** Re-verifica la cadena completa; detecta manipulación del pasado. */
export function verifyChain(entries: LedgerEntry[]): ChainCheck {
  let prevHash = GENESIS;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry) return { ok: false, brokenAt: i + 1 };
    if (entry.prevHash !== prevHash) return { ok: false, brokenAt: entry.seq };
    const { hash, ...rest } = entry;
    if (ledgerHash(rest) !== hash) return { ok: false, brokenAt: entry.seq };
    prevHash = hash;
  }
  return { ok: true };
}

/** Head-hash del ledger, para anclar en git. */
export function headHash(entries: LedgerEntry[]): string {
  return entries[entries.length - 1]?.hash ?? GENESIS;
}

export interface LedgerReport {
  total: number;
  denies: number;
  exceptions: number;
  chain: ChainCheck;
  head: string;
}

export function report(entries: LedgerEntry[]): LedgerReport {
  return {
    total: entries.length,
    denies: entries.filter((e) => e.outcome === "deny").length,
    exceptions: entries.filter((e) => e.outcome === "exception").length,
    chain: verifyChain(entries),
    head: headHash(entries),
  };
}
