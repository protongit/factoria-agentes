# Observabilidad

## Eventos en vivo y catch-up

- **`RunEvent`**: unidad de observabilidad. Campos: `runId`, `stepRunId?`, `seq` (monótono por run), `level`, `source` (`orchestrator`|`agent`|`system`|`tool`), `message`, `payload`, `createdAt`.
- Se persisten **siempre** (haya o no cliente), lo que garantiza el histórico.
- **API**:
  - `GET /runs/:id/events?sinceSeq=N` → histórico desde la última posición vista.
  - `GET /runs/:id/events/stream` (SSE) o WS → live.
- **Reconexión**: el cliente manda su `lastSeenSeq` y recibe primero el histórico y luego el live, sin huecos.
- **Catch-up con IA**: al volver el usuario se genera un `RunSummary` (resumen del periodo ausente) con el asistente de proyecto.

## Salida del modelo y razonamiento

El ejecutor de opencode traduce los eventos del agente a eventos de dominio con `payload.kind`:

- `text`: texto del mensaje del asistente (solo del assistant; no se re-emite el prompt del usuario).
- `reasoning`: razonamiento del modelo, si el proveedor lo expone.
- `tool`: llamada a herramienta con `tool`, `status` (`pending`/`running`/`completed`/`error`), `input` y `output` (truncado).
- `usage`: tokens de entrada/salida/coste.
- `error`: error real del proveedor (se propaga al paso y al run; no se marca como éxito).

La UI de ejecuciones muestra estos eventos en vivo y permite ocultar razonamiento/herramientas con una casilla. Los errores transitorios de red se reintentan (`AGENT_PROMPT_RETRIES`, por defecto 2 intentos).

## Contratos

Los contratos se **re-verifican siempre** al pasar por `contract_check` y al cerrar cada run. Un contrato `satisfied` de una ejecución anterior no se da por bueno: se vuelve a ejecutar su comando (o su juez) y se actualiza `status`, `evidence` y `lastVerifiedAt`. Así, si los ficheros desaparecen o el workspace cambia, el contrato deja de estar en verde.

## Trazas estructuradas

- **`TraceSpan`**: `runId`, `stepRunId`, `parentId`, `kind`, `name`, `attributes`, `inputTokens`, `outputTokens`, `cost`, `startedAt`, `endedAt`.
- Jerarquía padre-hijo: **run → paso → (tool | subagente)**. Cada invocación de subagente genera un span hijo.
- El visor de trazas muestra el árbol, la duración y el coste por nodo.
- Los eventos del ejecutor (SSE de opencode) se traducen a spans y eventos de dominio.

## Token counter y coste

- **`UsageRecord`**: por llamada — `providerId`, `modelId`, `subagentId`, `kind` (`chat`|`embedding`|`rerank`|`image`), `inputTokens`, `outputTokens`, `cachedTokens`, `reasoningTokens`, `cost`.
- **Agregaciones**: por paso → run → **proyecto** → usuario/proveedor/modelo/subagente.
- **`ProjectBudget`**: límite duro y blando; al superar el blando se emite alerta, al superar el duro se pausa la ejecución.
- Incluye el coste de embeddings, rerank y generación de imágenes.

## Panel del proyecto

- Estado del run actual y paso en curso.
- Timeline de pasos con estado, modelo y subagente.
- Stream de eventos y visor de trazas.
- Diffs por paso.
- Contadores de tokens y coste acumulado, con presupuesto.
- Cola de aprobaciones pendientes.

## Notificaciones

- Eventos de interés (fin de run, fallo, aprobación pendiente, alerta de presupuesto) notificables por canal (UI, email, webhook) — extensible.

## Protocolo de pruebas de usabilidad (desarrollo)

Durante la implementación se usa el MCP **browsermcp** para recorrer **casos de uso completos** contra la app en ejecución (alta de proveedor, crear proyecto, editar flujo, lanzar run, aprobar, catch-up…) y detectar problemas de usabilidad. Ver `AGENTS.md`.
