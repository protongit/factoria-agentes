# Factoría de Agentes

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522-339933.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A512-F69220.svg)](https://pnpm.io)

Plataforma web multiusuario para **orquestar agentes de IA que desarrollan software de forma automatizada**: define proyectos y flujos de trabajo (DAG), ejecuta agentes y subagentes, verifica contra contratos y ofrece observabilidad total.

> Estado: **MVP funcional**. Arquitectura y diseño cerrados en `docs/`. Ver el estado por fases en [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md).

## Funcionalidades

- **Proveedores y modelos** con capacidades (código, visión, razonamiento, tool-use, structured output, contexto largo, embeddings, rerank, imagen).
- **Subagentes**: catálogo con 12 plantillas, permisos mínimos y materialización al formato de cada ejecutor (opencode / Claude Code / Codex).
- **Flujos de trabajo** como grafo visual (React Flow): nodos, conexiones condicionales, fan-out/fan-in y bucles de corrección.
- **Proyectos** con funcionalidades, contratos (gate de finalización), documentación de referencia y generada, y asignación de flujo.
- **Ejecución** orquestada por un scheduler durable (BullMQ): paralelismo, joins, bucles con `loopGuard` y aislamiento de escrituras por directorio de trabajo.
- **Observabilidad en vivo**: eventos SSE con `seq` (catch-up sin huecos), trazas estructuradas y token counter por ejecución.
- **Avisos proactivos**: notificaciones en la UI y en el navegador (validación pendiente, fallo con motivo y pasos siguientes, fin de ejecución) y mensaje del asistente por cada aviso.
- **Asistente del proyecto**: chat, propuestas de definición con aprobación, generación de imágenes (bocetos) y resumen de ausencia.
- **RAG y memoria**: contexto del proyecto, búsqueda sobre la documentación y memoria de largo plazo.
- **Método y gates** (porte nativo de Karajan v4): review gate cross-AI atado al hash del diff, hooks de git deterministas, Sentinel (card-first, rag-first, bash-write, discard, governance…), verificación de *claims* anti-alucinación, Steward de garantías que caducan y ledger de gobernanza encadenado por hash.
- **Desarrollo en contenedor por proyecto**: cada proyecto corre en su propio contenedor aislado (socket proxy, sin root, red cerrada por defecto), arrancable desde la ficha del proyecto.
- **Entorno del proyecto**: vista previa estática (si hay `index.html`) y arranque del servidor de desarrollo (Vite/Next/Express…) con puerto publicado y logs.
- **Descarga del proyecto**: exportación del workspace en `.tar.gz` desde la pestaña Archivos.
- **Salida del modelo en vivo**: texto, razonamiento y llamadas a herramientas del agente visibles en el stream del run.
- **Credenciales Git**: token de GitHub/GitLab cifrado en reposo e inyectado en runtime.


## Documentación

- [`docs/README.md`](./docs/README.md) — **índice completo de la documentación**.
- [`docs/GUIA-DE-USUARIO.md`](./docs/GUIA-DE-USUARIO.md) — **guía de usuario paso a paso** (para lectores sin conocimientos técnicos).
- [`docs/manual-usuario.html`](./docs/manual-usuario.html) — **manual en HTML** (abrible en el navegador; también disponible en `/manual-usuario.html` con la app en marcha).
  - Incluye **capturas reales** (`docs/manual/`). Se regeneran con `node scripts/manual-shots.mjs` (requiere la app en marcha y `puppeteer-core`, ya en devDependencies).
- [`docs/SPEC.md`](./docs/SPEC.md) — especificación funcional.
- [`docs/DOMAIN-MODEL.md`](./docs/DOMAIN-MODEL.md) — entidades y relaciones.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — capas, stack e infraestructura.
- [`docs/ORCHESTRATION.md`](./docs/ORCHESTRATION.md) — motor de orquestación.
- [`docs/HARNESS-AND-CONTRACTS.md`](./docs/HARNESS-AND-CONTRACTS.md) — harness, subagentes y contratos.
- [`docs/RAG-AND-MEMORY.md`](./docs/RAG-AND-MEMORY.md) — Project Info MCP, RAG y memoria.
- [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md) — eventos, trazas, tokens y catch-up.
- [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md) — fases y tareas.
- [`docs/FLOWS.md`](./docs/FLOWS.md) — flujos de trabajo y pipelines de Karajan.
- [`docs/CONTAINERS-AND-GIT.md`](./docs/CONTAINERS-AND-GIT.md) — contenedores por proyecto y credenciales Git.
- [`docs/GATES-AND-SENTINEL.md`](./docs/GATES-AND-SENTINEL.md) — gates deterministas y Sentinel.
- [`docs/GOVERNANCE.md`](./docs/GOVERNANCE.md) — ledger de gobernanza y ADRs.

## Estructura

```
apps/
  api/         Fastify + JWT (REST, SSE/WS)
  worker/      Orquestador (BullMQ) + executors
  web/         React + Vite + React Flow
packages/
  shared/      Enums, tipos y schemas Zod
  db/          Esquema Drizzle + migraciones
  core/        Dominio y orquestación (grafo, contratos, verificación)
  executors/   AgentExecutor + OpenCode/ACP/CLI
docs/          Especificación y arquitectura
```

## Requisitos

- Node.js ≥ 22 y pnpm ≥ 12.
- Docker + Docker Compose (para el stack completo).

## Puesta en marcha (local)

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm test
```

## Puesta en marcha (contenedores)

```bash
cp .env.example .env
docker compose up -d --build
# Aplicar migraciones (una vez):
docker compose exec api pnpm --filter @factoria/db db:migrate
```

- Web: http://localhost:8088
- API: http://localhost:4000/api/health

Todos los servicios de datos (postgres, redis, worker) viven en la red privada `internal`; sólo `web` y `api` publican puertos.

## Workspace de los proyectos

Los workspaces viven en el bind **`./.workspaces`** del host (`WORKSPACES_HOST_ROOT`), que se monta en `api`, `worker` y en el contenedor de cada proyecto.

> Si vienes de una versión que usaba el volumen nombrado `factoria-agentes_workspaces`, migra sus datos una vez:
>
> ```bash
> docker run --rm -v factoria-agentes_workspaces:/from \
>   -v "$PWD/.workspaces":/to docker.io/library/nginx:alpine \
>   sh -c 'cd /from && find . -type f | while read -r f; do d="/to/${f#./}"; [ -e "$d" ] || { mkdir -p "$(dirname "$d")"; cp -a "$f" "$d"; }; done'
> ```
>
> Cambiar de volumen sin migrar deja los proyectos antiguos sin ficheros (aunque sus contratos sigan marcados como satisfechos de ejecuciones previas).

## Entorno y app del proyecto

En la pestaña **Entorno**:

- **Vista previa estática**: si el workspace tiene `index.html`, se sirve autenticada en `/api/projects/:id/preview/` y se muestra en un iframe.
- **Servidor de desarrollo**: ejecuta el comando configurado dentro del contenedor del proyecto en el puerto indicado. El puerto se publica en `127.0.0.1` del host y se muestra un enlace/iframe para probar la app y ver sus logs.
- El comando se puede dejar vacío para autodetectarlo desde `package.json` (`dev`/`start`) o usar `python3 -m http.server` como fallback.
- El proceso se ejecuta como root dentro del contenedor aislado del proyecto (el bind del workspace pertenece a root en Podman rootless). Si necesita `npm install`, usa la red **Abierta** del proyecto o instala las dependencias antes.

En la pestaña **Archivos** puedes explorar el workspace y **descargar el proyecto en `.tar.gz`** (sin `.git`, `node_modules`, `.worktrees`, `.factoria` ni `.env`).

## Ejecución de agentes

Por defecto se usa un **ejecutor simulado** si no hay runtime de agentes. Para usar agentes reales con opencode, arranca el servidor y expón su URL al worker:

```bash
docker compose exec worker opencode serve --port 4096 --hostname 0.0.0.0 &
# define OPENCODE_URL=http://127.0.0.1:4096 en el servicio worker y reinícialo
```

El orquestador resuelve explícitamente un modelo apto para cada paso (nodo → harness del proyecto → modelo del asistente → primer modelo habilitado con capacidad de código/`toolUse`). Si no hay ninguno, el paso falla con un error claro en vez de dejar que opencode use un modelo por defecto. Los errores del proveedor se propagan al run y los fallos transitorios de red se reintentan una vez.

## Fases

Ver [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md) para el estado por fases y las desviaciones conocidas.

## Contribuir

Las contribuciones son bienvenidas. Lee [`CONTRIBUTING.md`](./CONTRIBUTING.md)
para preparar el entorno y las convenciones, y respeta el
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

Antes de enviar cambios:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Seguridad

No abras issues públicos para vulnerabilidades: sigue
[`SECURITY.md`](./SECURITY.md).

## Licencia

Distribuido bajo licencia **MIT**. Consulta [`LICENSE`](./LICENSE).

