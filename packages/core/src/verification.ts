import type { ContractVerification } from "@factoria/shared";

export interface Verdict {
  passed: boolean;
  reasons: string[];
  evidence?: unknown;
}

export interface VerificationInput {
  expectedResult?: string;
  output: string;
  diff?: string;
  workingDir: string;
}

export interface Verifier {
  readonly kind: ContractVerification;
  verify(input: VerificationInput): Promise<Verdict>;
}

/**
 * Verificación determinista por comando: el código de salida decide.
 * (La ejecución real del comando la aporta el worker con acceso al filesystem.)
 */
export function commandVerifier(runCommand: (cmd: string, cwd: string) => Promise<number>): Verifier {
  return {
    kind: "command",
    async verify(input) {
      const cmd = input.expectedResult ?? "";
      const code = await runCommand(cmd, input.workingDir);
      return {
        passed: code === 0,
        reasons: code === 0 ? ["El comando de validación terminó con éxito"] : [`El comando salió con código ${code}`],
        evidence: { exitCode: code },
      };
    },
  };
}

/**
 * Verificación por juez IA. El worker inyecta una función que llama al modelo
 * evaluador con structured output (JSON Schema) y devuelve el veredicto.
 */
export function llmVerifier(judge: (input: VerificationInput) => Promise<Verdict>): Verifier {
  return { kind: "llm", verify: judge };
}

/** Verificación manual: queda pendiente de aprobación humana. */
export const manualVerifier: Verifier = {
  kind: "manual",
  async verify(): Promise<Verdict> {
    return { passed: false, reasons: ["Pendiente de aprobación humana"] };
  },
};

/**
 * Verificación híbrida: usa el verificador determinista si hay comando de
 * validación; en caso contrario, el juez IA; y si es ambiguo, queda para humano.
 */
export function hybridVerdict(
  deterministic: Verdict | undefined,
  judged: Verdict | undefined,
): Verdict {
  if (deterministic) return deterministic;
  if (judged) return judged;
  return { passed: false, reasons: ["Requiere aprobación humana"] };
}
