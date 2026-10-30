import type { AdrStatus } from "@factoria/shared";

export interface Adr {
  number: number;
  title: string;
  status: AdrStatus;
  context: string;
  decision: string;
  consequences: string;
}

/** Siguiente número de ADR (empezando en 1). */
export function nextAdrNumber(existing: { number: number }[]): number {
  return existing.reduce((max, a) => Math.max(max, a.number), 0) + 1;
}

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

export function adrSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Ruta git-tracked del ADR dentro del proyecto. */
export function adrPath(number: number, title: string): string {
  return `.factoria/adrs/${pad(number)}-${adrSlug(title)}.md`;
}

/** Render Markdown de un ADR (formato MADR simplificado). */
export function renderAdr(adr: Adr): string {
  return `# ${pad(adr.number)}. ${adr.title}

- Estado: ${adr.status}
- Fecha: ${new Date().toISOString().slice(0, 10)}

## Contexto

${adr.context || "_(sin contexto)_"}

## Decisión

${adr.decision}

## Consecuencias

${adr.consequences || "_(sin consecuencias registradas)_"}
`;
}
