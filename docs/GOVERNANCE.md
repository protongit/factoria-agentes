# Gobernanza y ADRs

## Ledger encadenado por hash

Cada decisión del método (deny de un gate, veredicto de revisión, claims desmentidos, caducidad del Steward) se sella en `policy_decisions` como una entrada **append-only** encadenada:

- `hash = sha256(contenido canónico + prevHash)` (`packages/core/src/governance.ts`).
- `verifyChain` reconstruye la cadena y detecta manipulación del pasado (`brokenAt`).
- `headHash` permite **anclar** el head en `.factoria/policy-anchor.json`.

API:

- `GET /projects/:id/governance` → entradas + informe (`report`): total, denies, excepciones, integridad de la cadena y head.
- `POST /projects/:id/governance/anchor` → ancla el head.

La pestaña **Método** de la ficha del proyecto muestra la gobernanza, los veredictos de revisión, los ADRs, los claims y las reglas.

## ADRs (Architecture Decision Records)

- Git-tracked en `.factoria/adrs/NNNN-titulo.md` (formato MADR simplificado).
- Nodo de flujo `adr` y `POST /projects/:id/adrs`.
- `GET /projects/:id/adrs` lista las decisiones.

## Steward (confianza que expira)

`stewardSweep` (`packages/core/src/steward.ts`) marca como `unknown` los contratos caducados (`expiresAt`) o con verificación más antigua que `maxAgeMs`. La evidencia caducada nunca se mantiene verde. Endpoint: `POST /projects/:id/steward/sweep`.
