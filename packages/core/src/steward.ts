import type { ContractStatus } from "@factoria/shared";

export interface GuaranteeLike {
  id?: string;
  title?: string;
  status: ContractStatus;
  lastVerifiedAt?: Date | string | null;
  expiresAt?: Date | string | null;
}

export interface StaleGuarantee {
  id: string;
  title?: string;
  ageMs: number;
}

function toTime(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Steward: una garantía caduca si `expiresAt` ya pasó, o si su última
 * verificación es más antigua que `maxAgeMs`. La evidencia caducada deja de
 * contar: pasa a `unknown`, nunca se mantiene verde.
 */
export function isStale(g: GuaranteeLike, now: Date, maxAgeMs: number): boolean {
  const expires = toTime(g.expiresAt);
  if (expires !== undefined) return expires <= now.getTime();
  const last = toTime(g.lastVerifiedAt);
  if (last === undefined) return g.status === "satisfied";
  return now.getTime() - last > maxAgeMs;
}

export interface SweepResult {
  changes: { id: string; from: ContractStatus; to: ContractStatus }[];
  stale: StaleGuarantee[];
}

/** Barrido del Steward: marca como `unknown` lo caducado. */
export function stewardSweep(
  guarantees: GuaranteeLike[],
  now: Date = new Date(),
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
): SweepResult {
  const changes: SweepResult["changes"] = [];
  const stale: StaleGuarantee[] = [];
  for (const g of guarantees) {
    if (g.status !== "satisfied") continue;
    if (!isStale(g, now, maxAgeMs)) continue;
    const id = g.id ?? g.title ?? "unknown";
    stale.push({ id, title: g.title, ageMs: now.getTime() - (toTime(g.lastVerifiedAt) ?? now.getTime()) });
    changes.push({ id, from: g.status, to: "unknown" });
  }
  return { changes, stale };
}
