import type { ContractStatus } from "@factoria/shared";

export interface ContractLike {
  status: ContractStatus;
}

/** ¿Se pueden dar por cumplidos todos los contratos? (gate de finalización) */
export function allContractsSatisfied(contracts: ContractLike[]): boolean {
  return contracts.every((c) => c.status === "satisfied");
}

export interface CompletionGate {
  canComplete: boolean;
  pending: number;
  failed: number;
}

/** Evalúa el gate de finalización del proyecto. */
export function completionGate(contracts: ContractLike[]): CompletionGate {
  const pending = contracts.filter((c) => c.status === "pending").length;
  const failed = contracts.filter((c) => c.status === "failed").length;
  return { canComplete: pending === 0 && failed === 0, pending, failed };
}
