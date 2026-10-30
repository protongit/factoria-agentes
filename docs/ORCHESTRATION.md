# Orquestación

Motor propio, durable y desacoplado del navegador. Implementado en `packages/core` y ejecutado por `apps/worker` sobre BullMQ.

## El grafo

Un flujo de trabajo es un **grafo dirigido con ciclos acotados**:

- **Nodos** (`WorkflowNode`) con tipo, y **aristas** (`WorkflowEdge`) con condición.
- **Fan-out**: un nodo con varios sucesores sin dependencias entre ellos → se ejecutan **en paralelo**.
- **Fan-in**: un nodo con varios predecesores espera según `joinPolicy` (`all` = todos; `any` = el primero que termine).
- **Ramas condicionales**: cada arista lleva una `condition` evaluada contra el `verdict` del nodo.
- **Bucles**: aristas de vuelta (back-edges) para corrección. Acotados por `loopGuard` (`maxIterations`, `maxVisits`).

### Tipos de nodo

| Tipo | Función |
|---|---|
| `start` / `end` | Puntos de entrada y salida. |
| `task` | Ejecuta un agente/subagente con un modelo y harness. |
| `gate` | Verificación/QA (p. ej. el `revisor`). |
| `join` | Consolida ramas paralelas (fan-in). |
| `orchestrator` | Reparte y consolida (delega en subagentes vía `permission.task`). |
| `condition` | Enrutado por IA (structured output) o por expresión. |
| `loop` | Control de iteración sobre una subsección. |
| `subworkflow` | Ejecuta otro workflow como `WorkflowRun` hijo (recursión acotada). |
| `human_approval` | Pausa hasta aprobación del usuario. |
| `contract_check` | Evalúa contratos y bloquea/continúa. |
| `push_repo` / `documentation` / `notify` | Acciones utilitarias. |

## Scheduler

Estado persistente en PostgreSQL; la cola sólo transporta trabajo.

1. **Materialización**: al iniciar un `WorkflowRun` se copia el `graphSnapshot`. Los nodos sin predecesores pasan a `ready`.
2. **Despacho**: cada nodo `ready` se encola como job BullMQ. Los jobs independientes corren en paralelo con límites:
   - `concurrency` global del worker,
   - límite por proyecto,
   - límite por proveedor (respetar rate limits).
3. **Ejecución**: el job resuelve modelo + subagente + harness, prepara el directorio de trabajo y lanza el adapter.
4. **Cierre de nodo**: se persiste el `verdict`; el scheduler evalúa las aristas salientes y marca nuevos nodos `ready`. Si se atraviesa un **back-edge**, se **resetean** los `StepRun` downstream afectados y se incrementa `iteration` (respetando `loopGuard`).
5. **Join**: el nodo `join` arranca cuando sus predecesores cumplen `joinPolicy`.
6. **Fin**: al alcanzar `end`, se evaluarán los **contratos**; sólo con todos `satisfied` el proyecto pasa a `completed`.

## Aislamiento de escrituras

- Cada nodo declara su `workingDir` (relativo a `workspaceRoot` del proyecto).
- El scheduler comprueba los nodos **concurrentes**:
  - directorios disjuntos → ejecutan directamente;
  - **mismo directorio/solape** → se crean **git worktrees** (una rama por nodo) y el `join` hace **merge** en una rama de integración.
- Sin git disponible y con conflicto de directorio → se **serializa** la pareja (con aviso).

## Verificación del resultado esperado (híbrida)

Al terminar un nodo se determina si cumple `expectedResult`:

1. **Determinista**: si el harness define `validationCommand`, se ejecuta y se usa el código de salida.
2. **Juez IA**: en caso contrario, un modelo evaluador recibe la salida, el diff y los contratos relevantes, y emite un **veredicto estructurado** (JSON Schema): `{ passed, reasons, evidence }`.
3. **Humano**: si el resultado es ambiguo o el nodo lo requiere, pasa a `waiting_approval` y espera decisión del usuario.

## Durabilidad y catch-up

- **El navegador es sólo un observador**: no hay estado de ejecución en el cliente.
- Los `RunEvent` se persisten **siempre**, con `seq` monótono por run.
- Al reconectar: `GET /runs/:id/events?sinceSeq=N` devuelve el histórico desde la última posición vista y luego se abre el stream en vivo (SSE/WS).
- El **asistente de proyecto** genera un `RunSummary` (resumen del periodo ausente).
- **Reinicio del worker**: se rehidrata desde PostgreSQL; los `StepRun` en `running` se reconcilian con la sesión persistida del agente (`--session` de opencode) o se reencolan.

## Estados del run

`queued → running → (paused ↔ running) → succeeded | failed | cancelled`

## Contratos (gate de finalización)

- Los contratos se definen a nivel de proyecto.
- Se actualizan a `satisfied`/`failed` según la verificación de los pasos.
- El proyecto no puede pasar a `completed` con contratos `pending` o `failed`.

## Concurrencia y cancelación

- Un workflow run activo por proyecto (configurable).
- Cancelar un run detiene nuevos despachos y aborta sesiones en curso (`session.abort`).
- Pausar/reanudar conserva el estado del grafo y los `StepRun` en `waiting_approval`.
