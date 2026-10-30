# Plan de implementación

Cada fase se considera terminada cuando compila, pasa typecheck/lint y sus casos de uso se validan (UI mediante **browsermcp**).

## Estado actual

| Fase | Estado | Notas |
|---|---|---|
| F0 Scaffolding | ✅ | Monorepo, compose, auth, esquema de dominio, docs. |
| F1 Proveedores y modelos | ✅ | CRUD + capacidades + credenciales AES-256-GCM + **test de conexión** y **sync** contra `/models` del proveedor. |
| F2 Proyectos/features/contratos/docs | ✅ | CRUD completo; propuestas del asistente; **explorador del workspace con visor de ficheros** (navegación por directorios, tamaños, detección de binarios, protección anti path‑traversal). |
| F3 Editor de flujos (DAG) | ✅ | Nodos personalizados, colores por tipo, aristas etiquetadas, auto-layout, **variables** y **versiones restaurables**. |
| F4 Ejecutor opencode | ✅ | Runtime gestionado por la plataforma: genera `auth.json`+config, arranca `opencode serve`, sesiones dirigidas al workspace; `MockExecutor` solo si no puede arrancar. **Ejecución real verificada con `nan/glm5.3-flash`**. |
| F5 Subagentes | ✅ | Catálogo, 12 plantillas, materialización, asignación a tareas. |
| F6 Scheduler durable | ✅ | BullMQ, paralelismo, fan-in, bucles, **git worktrees**, **reanudación** y **reconciliación** tras reinicio. |
| F7 Verificación + contratos | ✅ | Comando determinista + **juez IA (structured output)** + **human_approval** con UI de aprobación + gate de contratos + router de condición. |
| F8 RAG + Project Info + memoria | ✅ | **Embeddings + índice HNSW (pgvector) + rerank**, **servidor MCP** (`apps/mcp`, stdio) y memoria vectorizada. |
| F9 Asistente de proyecto | ✅ | Chat y propuestas con **modelo real**, **idempotencia** de propuestas, imágenes reales y **RunSummary** persistido. |
| F10 Observabilidad, tokens y catch-up | ✅ | Eventos SSE con `seq`, catch-up, **visor de trazas**, token counter y **presupuestos**. |
| F11 Adapters ACP/CLI + sandbox | ✅ (parcial) | **ACP con transporte JSON-RPC**, CLI genérico y worktrees; *sandbox* por contenedor best-effort. |
| F12 Pulido + E2E | ✅ | **i18n es/en (shell)**, Prettier, 19 tests unitarios y E2E con browsermcp/HTTP. |
| F13 Método (porte nativo de Karajan v4) | ✅ | **Review gate cross-AI** atado al sha256 del diff, **hooks de git** (pre-commit/commit-msg/pre-push), **Sentinel** (card-first, rag-first, bash-write, discard, governance, commit-gate, cross-lane, attribution), **claims** anti-alucinación, **Steward** (caducidad→unknown), **ledger** de gobernanza encadenado por hash, **ADRs** git-tracked, reglas compiladas desde `AGENTS.md`. |
| F14 Entornos y Git | ✅ | **Contenedor por proyecto** (Docker Socket Proxy, imagen `project-dev`, sin root, red cerrada por defecto, auto-arranque), pestaña **Entorno**, **credenciales Git** cifradas (GitHub/GitLab) y `repo/test`. |

### Incidencias encontradas y corregidas

- **React #310** en el detalle del proyecto (hooks tras return condicional).
- **POST sin cuerpo → 400** (Content-Type con body vacío) en aceptar propuesta, resumen, logout y borrados.
- **Nodo sin aristas entrantes** no se ejecutaba.
- **Bucles** bloqueaban el arranque (las back-edges no deben bloquear la preparación).
- **Reanudación con `jobId` duplicado**: BullMQ ignoraba el reencolado; ahora usa un id único.
- **Arranque de opencode colgado**: `fetch` del health podía no resolver indefinidamente; ahora usa `AbortSignal.timeout` por intento + timeout global (y logs).
- **`providerID` de opencode**: se derivaba del `modelId` (sin prefijo); ahora se usa el id del proveedor (`nan`). Sin esto el ejecutor real no encontraba el modelo.
- **Review gate con diff vacío**: no incluía ficheros nuevos; ahora hace `git add -A` + `git diff --cached`.
- **Revisor cross-AI**: elegía modelos premium (401) o sin clave descifrable; ahora deriva el autor del predecesor, prioriza familia distinta y prueba candidatos hasta uno válido.
- **Fallos de job dejaban el run colgado**: ahora el worker marca run/paso como `failed` si el job lanza.
- **Modelo borrado dejaba el nodo sin modelo**: opencode caía en un modelo por defecto (p. ej. `whisper`) y el error del proveedor se silenciaba como `succeeded`. Ahora se resuelve un modelo apto explícito (nodo → harness → asistente → primer modelo con `code`/`toolUse`), se propagan los errores del executor y se reintentan fallos transitorios.
- **Contratos en verde con ficheros ausentes**: `evaluateContracts` omitía los contratos ya `satisfied`; ahora se re-verifican siempre y se guarda `lastVerifiedAt`/evidencia.
- **Workspace vacío tras cambiar de volumen**: los runs antiguos escribieron en el volumen nombrado y el compose pasó a bind; se documenta y se añade migración a `./.workspaces`.
- **Sin forma de probar la app generada**: se añadió vista previa estática, arranque del servidor de desarrollo con puerto publicado/logs y descarga del proyecto en `.tar.gz`.
- **Log del agente mostraba el prompt y no el razonamiento**: el executor ahora filtra el mensaje de usuario y emite `text`, `reasoning` y `tool` con su estado.

### Desviaciones conocidas

- **Un job por run** (no un job por nodo): el scheduler ejecuta el grafo dentro de un único job con paralelismo interno; la reconciliación al arrancar reencola los runs inacabados.
- **Trazas**: ahora con span raíz por run y `parentId` en los spans de paso; sin árbol completo de tools.
- **i18n**: infraestructura y traducción del *shell* (navegación, login, acciones comunes); el contenido interno de las páginas permanece en español.
- **RAG**: los embeddings se fuerzan a 1536 dims (relleno/recorte); requieren un modelo con `embeddings` en el proyecto.
- **ACP**: cliente JSON-RPC con métodos configurables; no probado contra un agente ACP real aquí.
- **Lint**: ESLint no está configurado; el gate de calidad es `pnpm typecheck` + `pnpm test` (19 tests en `core`) y Prettier.
- **Turbo**: en este entorno no lanza subprocesos; los scripts raíz usan `pnpm -r`.
- **Contenedores**: el motor puede ser Docker o Podman rootless. Configura `DOCKER_SOCKET_PATH` (p. ej. `/run/user/1000/podman/podman.sock`) y `WORKSPACES_HOST_ROOT` (ruta absoluta del host para los workspaces, que se monta como bind en `api`/`worker` y en los contenedores de proyecto). Sin `WORKSPACES_HOST_ROOT` se asume que el daemon comparte el filesystem del contenedor.
- **Ejecución real**: el `MockExecutor` se usa cuando no hay `OPENCODE_URL` ni `OPENCODE_ENABLE_REAL=1`. Para probar el método sin proveedor, configura un flujo con nodos `adr`/`review_gate`/`contract_check` (no requieren modelo).

### Desarrollo real con agentes (Fase A — verificada)

La plataforma ejecuta **desarrollo de software real** con agentes de IA:

- **Runtime opencode gestionado por la plataforma** (`apps/worker/src/opencode-runtime.ts`): genera `auth.json` con las claves descifradas de los proveedores y `opencode.json` con baseURL/modelos/MCP, y arranca `opencode serve` automáticamente (timeout configurable `OPENCODE_START_TIMEOUT`).
- **Workspace preparado por proyecto** (`apps/worker/src/workspace.ts`): `mkdir`, `git init`/`clone` (local o remoto con `repoUrl`) y `AGENTS.md` del proyecto; `workingDir` de cada paso creado al vuelo.
- **Contexto inyectado en el prompt**: funcionalidades, contratos, memoria (semántica) y top‑K RAG; `mcpServers`/`skills` del harness llegan al ejecutor.
- **Subagentes materializados** como `.opencode/agent/<name>.md` en el workspace antes del paso.
- **Sesiones dirigidas al proyecto**: el cliente opencode se crea con `directory: workspaceDir`.
- **Ejecución real verificada** (modelo `nan/glm5.3-flash`): el agente creó `hello.txt` y `util.js`, el `validationCommand` pasó (código 0) y el run terminó `succeeded` con tokens reales registrados.
- **Control en caliente**: cancelar/pausar publican por Redis y el worker **aborta las sesiones activas** (`abortRun`/`requestPause`).
- **Límite de concurrencia por proveedor** (`MAX_CONCURRENT_PER_PROVIDER`, 3 por defecto).

### Verificación independiente (subagentes)

Se lanzaron subagentes de auditoría de código y de E2E. Tras las correcciones se verificó en vivo: test/sync de proveedor, RAG semántico (embeddings+rerank), presupuesto, ejecución con eventos/uso/trazas, *human approval* (pausa→aprobar→reanudar), versiones de flujo (restauración de v1), subworkflow (lanza run hijo), condición determinista, `contract_check` y servidor MCP (initialize + tools/list + tools/call).

## F0 — Scaffolding y base


- Monorepo pnpm + Turborepo, `tsconfig` base, ESLint/Prettier.
- Paquetes `shared`, `db`, `core`, `executors` y apps `api`, `worker`, `web`.
- `docker-compose` con servicios en red privada (postgres+pgvector, redis, mcp-project, api, worker, web).
- Autenticación básica (registro/login, JWT en cookie), roles.
- Documentación (`docs/`) y `AGENTS.md` con protocolo browsermcp.

**Entregable:** `docker compose up` levanta la plataforma; healthcheck OK; login funcional.

## F1 — Proveedores y modelos

- CRUD de proveedores con credenciales cifradas (AES-256-GCM).
- CRUD de modelos con asignación de **capacidades** (code, vision, reasoning, toolUse, structuredOutput, longContext, embeddings, rerank, imageGeneration).
- Test de conexión y sincronización con `/provider` de opencode.

## F2 — Proyectos, funcionalidades, contratos y documentación

- CRUD de proyectos con todos los atributos.
- Funcionalidades, contratos (con verificación) y documentos (subida de referencia + imágenes/bocetos; generados).
- Propuestas del asistente para cumplimentar la definición (features/stack/contratos a partir de la descripción).

## F3 — Editor de flujos (DAG visual)

- Editor con React Flow: paleta de nodos, conexiones condicionales, fan-out/fan-in, bucles, sub-workflows, aprobaciones.
- Configuración por nodo: modelo, subagente, descripción, `expectedResult`, harness, `workingDir`, `joinPolicy`, `loopGuard`.
- Versionado, plantillas y variables de proyecto.

## F4 — Ejecutor opencode

- Interfaz `AgentExecutor` + `OpenCodeExecutor` (SDK/`serve`: sesiones, SSE, structured output, diff).
- Ejecución de un nodo aislado extremo a extremo.

## F5 — Subagentes

- Catálogo CRUD, plantillas (12 subagentes), permisos y contrato de salida.
- Materialización a formatos de ejecutor (opencode/Claude Code/Codex).
- Asignación de subagentes a tareas y trazado de sus invocaciones.

## F6 — Scheduler durable

- BullMQ + scheduler persistente: fan-out/fan-in, paralelismo con límites, bucles con `loopGuard`.
- Aislamiento por `workingDir` y git worktrees con merge en `join`.
- Durabilidad: rehidratación tras reinicio y re-adjuntado de sesiones.

## F7 — Verificación híbrida y contratos

- Verificación por comando / juez IA (structured output) / humano.
- Gate de contratos para la finalización del proyecto.
- Nodo `contract_check` y `human_approval`.

## F8 — RAG, Project Info MCP y memoria

- Servicio `mcp-project` con tools/resources.
- Pipeline RAG (extracción → chunk → embeddings → pgvector → rerank) con modelos configurables.
- Memoria de largo plazo por proyecto/asistente/agente.

## F9 — Asistente de proyecto

- Chat persistente con acceso (lectura) a proyecto/docs/contratos/eventos/diffs vía MCP + RAG + memoria.
- Propuestas de definición sujetas a aprobación.
- Generación de imágenes (capability `imageGeneration`) adjuntadas al proyecto.
- Resúmenes de ausencia (`RunSummary`).

## F10 — Observabilidad, token counter y catch-up

- `RunEvent` con `seq`, endpoints de histórico/stream, reconexión sin huecos.
- `TraceSpan` con árbol padre-hijo; visor de trazas.
- `UsageRecord` y agregaciones; `ProjectBudget` con alertas.

## F11 — Adapters ACP y CLI + sandbox

- `AcpExecutor` (Agent Client Protocol) y `CliExecutor` (pi agent/otros).
- Sandbox opcional por run.

## F12 — Pulido

- i18n (es/en), accesibilidad, tests unitarios y **E2E con browsermcp**.
- Plantillas de flujo de referencia (p. ej. `backend ‖ frontend → revisor → push/docs`).

## Definición de "hecho" por fase

1. `pnpm typecheck` y `pnpm lint` sin errores.
2. Migraciones aplicadas y esquema coherente.
3. Casos de uso de la fase recorridos con browsermcp y sin errores de consola.
4. Documentación actualizada en `docs/`.
