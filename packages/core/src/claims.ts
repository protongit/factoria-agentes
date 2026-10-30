import type { ClaimStatus } from "@factoria/shared";

export interface Claim {
  text: string;
  status: ClaimStatus;
  evidence?: unknown;
}

/**
 * Afirmaciones duras típicas en la salida de un agente: "los tests pasan",
 * "compila sin errores", o cifras concretas. Heurística determinista.
 */
const CLAIM_PATTERNS: RegExp[] = [
  /\b(?:all\s+)?(?:tests?|suites?|la suite|las pruebas|los tests)\s+(?:pass|passes|passing|pasan|pasa|verdes?|green)\b/i,
  /\bno\s+(?:errors?|errores|warnings?)\b/i,
  /\bcompila\s+sin\s+errores\b/i,
  /\bbuild\s+(?:succeeds|passed|ok)\b/i,
  /\b\d+\s*(?:tests?|pruebas)\s+(?:pass|pasan|green|verdes?)\b/i,
  /\bcoverage\s+\d{1,3}\s*%/i,
];

export function extractClaims(output: string): string[] {
  const claims: string[] = [];
  for (const line of output.split(/\n|(?<=\.)\s+/)) {
    if (CLAIM_PATTERNS.some((re) => re.test(line))) claims.push(line.trim().slice(0, 300));
  }
  return [...new Set(claims)];
}

/**
 * Contrasta afirmaciones contra el transcript real de la sesión (salidas de
 * terminal/eventos). Una afirmación que el propio transcript desmiente es una
 * alucinación probada (`disproven`).
 */
export function crossCheckClaims(claims: string[], transcript: string): Claim[] {
  const lower = transcript.toLowerCase();
  const failed = /\b(fail|failed|failing|error|errores|rojo|failing|✗|✘)\b/.test(lower);
  const passed = /\b(pass|passed|passing|ok|verde|✓|success|succeeded)\b/.test(lower);

  return claims.map((text) => {
    const t = text.toLowerCase();
    const aboutTests = /test|prueba|suite|build|compila|error/.test(t);
    let status: ClaimStatus = "unbacked";
    if (aboutTests && failed && !passed) status = "disproven";
    else if (aboutTests && passed) status = "backed";
    else if (transcript.includes(text.slice(0, 24))) status = "backed";
    return { text, status, evidence: { failed, passed } };
  });
}

export interface ClaimsVerdict {
  passed: boolean;
  reasons: string[];
  claims: Claim[];
}

/** Un claim `disproven` bloquea (fail-closed): es una alucinación probada. */
export function evaluateClaims(output: string, transcript: string): ClaimsVerdict {
  const claims = crossCheckClaims(extractClaims(output), transcript);
  const disproven = claims.filter((c) => c.status === "disproven");
  return {
    passed: disproven.length === 0,
    reasons:
      disproven.length === 0
        ? ["Sin afirmaciones desmentidas por el transcript"]
        : disproven.map((c) => `Afirmación desmentida: «${c.text}»`),
    claims,
  };
}
