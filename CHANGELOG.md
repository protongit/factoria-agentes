# Changelog

Todos los cambios relevantes del proyecto se documentan en este fichero.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Añadido

- Avisos proactivos de ejecución: campana de notificaciones en la UI, notificaciones del navegador (con permiso) y mensaje del asistente con la situación y los pasos siguientes para aprobaciones pendientes, fallos, ejecuciones terminadas y canceladas.
- Motivo real del fallo en la ejecución y en el listado de avisos, con botón de replay desde el paso fallido.
- Enlaces profundos a la ejecución afectada (`?tab=runs&run=…`) desde las notificaciones.

### Corregido

- El error `fetch failed` de las ejecuciones largas: el cliente HTTP abortaba a los 300 s la llamada bloqueante `session.prompt`. Ahora se usa `promptAsync` y se espera el evento `session.idle`.
- Las solicitudes de permiso (`external_directory`, etc.) se responden automáticamente según el harness; antes podían dejar el turno colgado. `external_directory` y `doom_loop` se deniegan por defecto y el rechazo queda registrado como evento.
- La sesión del agente se aborta al fallar un paso, evitando que siga emitiendo eventos sobre una ejecución ya finalizada.
- El motivo del fallo se persiste en el paso (`step_runs.error`), no solo en el stream de eventos.
- Las tools `project-info_*` recibían el nombre de la carpeta del workspace en vez del UUID del proyecto y fallaban; ahora el prompt incluye el `project_id` correcto.

### Añadido

- Timeout explícito por paso (`AGENT_STEP_TIMEOUT`, 30 min por defecto) con aborto y mensaje legible.
- Fecha y hora en cada línea de observabilidad.
- Contexto de ejecuciones y log reciente para el asistente del proyecto.
- Tool MCP `get_run_log` para consultar la secuencia de eventos y errores de una ejecución.

### Añadido (documentación)

- Documentación de proyecto: licencia MIT, guía de contribución, código de
  conducta, política de seguridad y plantillas de issues/PR.

## [0.1.0] - 2026-10-31

Primera versión funcional (MVP).

### Añadido

- Monorepo pnpm + Turborepo con `apps/web`, `apps/api`, `apps/worker`,
  `apps/mcp` y paquetes compartidos `@factoria/shared`, `@factoria/db`,
  `@factoria/core` y `@factoria/executors`.
- Autenticación multiusuario con JWT y catálogo de proveedores y modelos con
  capacidades (código, visión, razonamiento, tool-use, structured output,
  contexto largo, embeddings, rerank e imagen).
- Proyectos con funcionalidades, contratos, documentación de referencia,
  explorador de archivos y descarga del workspace.
- Editor visual de flujos (DAG) con React Flow, conexiones condicionales,
  fan-out/fan-in, bucles de corrección, variables y versiones restaurables.
- Orquestación durable sobre BullMQ: paralelismo, joins, `loopGuard`,
  worktrees de Git, reanudación y reconciliación tras reinicio.
- Catálogo de subagentes con plantillas, permisos mínimos y materialización
  para opencode, Claude Code y Codex.
- Ejecución real de agentes mediante runtime opencode gestionado, con
  adaptadores ACP y CLI, y ejecutor simulado como fallback.
- Verificación determinista y con juez IA, aprobación humana y gate de
  contratos.
- RAG con pgvector (embeddings + HNSW + rerank), Project Info MCP y memoria de
  largo plazo.
- Asistente de proyecto: chat, propuestas con aprobación, generación de
  imágenes y resumen de ausencia.
- Observabilidad en vivo con SSE y `seq`, catch-up sin huecos, trazas, token
  counter y presupuestos.
- Método nativo (porte de Karajan v4): review gate cross-AI atado al hash del
  diff, hooks de Git, Sentinel, verificación de *claims*, Steward, ledger de
  gobernanza encadenado y ADRs.
- Contenedor aislado por proyecto (Docker Socket Proxy, sin root, red cerrada
  por defecto), vista previa estática y servidor de desarrollo.
- Credenciales Git cifradas en reposo e i18n es/en.

[Unreleased]: https://github.com/protongit/factoria-agentes/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/protongit/factoria-agentes/releases/tag/v0.1.0
