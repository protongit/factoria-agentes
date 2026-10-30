# Arquitectura

## Vista general

```
                          ┌──────────────────────── red privada (internal) ────────────────────────┐
   [Navegador] ──https──► │  web (Nginx: estáticos + proxy /api y /events)                          │
                          │      │                                                                   │
                          │      ▼                                                                   │
                          │  api (Fastify + WS/SSE + JWT)                                            │
                          │      │            ▲                                                      │
                          │      ▼            │ SSE/WS (catch-up + live)                              │
                          │  redis (BullMQ)  │                                                      │
                          │      │            │                                                      │
                          │      ▼            │                                                      │
                          │  worker (orquestador + executors + RAG)                                  │
                          │    │   │   │                                                             │
                          │    │   │   └─► mcp-project (Project Info MCP) ──► postgres(+pgvector)    │
                          │    │   └─────► subproceso opencode / ACP / CLI                           │
                          │    └─────────► postgres                                                  │
                          └──────────────────────────────────────────────────────────────────────────┘
                             volúmenes: data (postgres+redis) · workspaces (código de proyectos)
```

## Capas

- **web** (`apps/web`): SPA React. Editor de flujos (React Flow), proyectos, ejecuciones, asistente. Consume la API por REST y eventos por SSE/WS.
- **api** (`apps/api`): puerta de entrada. Auth, CRUD de recursos, validación Zod, publicación de eventos a clientes (SSE/WS) y encolado de trabajos en BullMQ. No ejecuta agentes.
- **worker** (`apps/worker`): ejecuta el orquestador. Consume la cola, corre agentes/subagentes por los adapters, persiste eventos/uso/trazas y reprograma el grafo.
- **mcp-project** (`packages/core` + servicio): expone el **Project Info MCP** (tools/resources) que consumen los agentes y subagentes.
- **PostgreSQL + pgvector**: persistencia de dominio + vectores (RAG y memoria).
- **Redis**: cola BullMQ y coordinación de concurrencia.

## Paquetes

| Paquete | Responsabilidad |
|---|---|
| `packages/shared` | Enums, tipos y schemas Zod compartidos. Fuente única de verdad de los tipos. |
| `packages/db` | Esquema Drizzle, cliente y migraciones. |
| `packages/core` | Dominio y orquestación: grafo, scheduler, verificación, contratos, harness, RAG, memoria, Project Info MCP. TS puro, sin framework. |
| `packages/executors` | Interfaz `AgentExecutor` y adapters `OpenCodeExecutor`, `AcpExecutor`, `CliExecutor`. |
| `apps/api` | Servidor HTTP + event bus hacia clientes. |
| `apps/worker` | Procesos de ejecución (BullMQ). |
| `apps/web` | Interfaz de usuario. |

## Stack

- **Lenguaje**: TypeScript (Node ≥ 22, runtime `tsx` en desarrollo y en contenedor).
- **Monorepo**: pnpm workspaces + Turborepo.
- **API**: Fastify 5, `@fastify/jwt`, `@fastify/cookie`, `@fastify/cors`, Zod.
- **Web**: React 19 + Vite + TanStack Query + `@xyflow/react` (React Flow) + Tailwind.
- **Datos**: PostgreSQL + pgvector, Drizzle ORM.
- **Cola**: BullMQ sobre Redis.
- **Ejecución**: `@opencode-ai/sdk` / `opencode serve` (primario), ACP (JSON-RPC/stdio), CLI genérico.
- **Observabilidad**: trazas propias en BD; stream SSE/WS.
- **Contenedores**: Docker + docker-compose, servicios en red privada.

## Contenedores y red

`docker-compose.yml` define:

| Servicio | Imagen | Red | Notas |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg16` | internal | volumen `data` |
| `redis` | `redis:7-alpine` | internal | volumen `data` |
| `mcp-project` | build `packages/core` | internal | Project Info MCP |
| `api` | build `apps/api` | internal + published `4000` | expuesto tras proxy |
| `worker` | build `apps/worker` | internal | escalable (`--scale worker=N`) |
| `web` | build `apps/web` (nginx) | internal + published `8080` | sirve estáticos y proxya `/api`, `/events` |

Solo `api` y `web` publican puertos; el resto viven en la red `internal`. Los volúmenes `data` y `workspaces` persisten entre reinicios.

## Flujo de una petición de ejecución

1. El usuario lanza un run → `api` valida, crea `WorkflowRun` y encola en BullMQ.
2. `worker` toma el run, materializa el grafo y encola los nodos `ready`.
3. Cada nodo ejecuta su subagente/modelo vía adapter; los eventos se persisten (`RunEvent`) y se difunden por el bus.
4. `api` retransmite eventos a los clientes conectados (SSE/WS); si no hay cliente, quedan en BD para el catch-up.
5. Al terminar cada nodo, el scheduler evalúa transiciones y encola los siguientes; al llegar a `end`, comprueba los contratos.

## Decisiones y justificación

- **Motor propio** en lugar de framework: control total sobre el modelo de subagentes, harness, contratos y observabilidad; sin acoplar el producto a un runtime externo.
- **opencode como ejecutor primario**: SDK/servidor con sesiones, SSE y structured output; ACP como vía de interoperabilidad.
- **pgvector en lugar de un vector DB externo**: menos infraestructura, misma transacción que el dominio.
- **Ejecución en worker, no en api**: el `api` permanece ligero y los runs son durables e independientes de las conexiones de cliente.
