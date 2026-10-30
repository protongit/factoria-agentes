# Contribuir a Factoría de Agentes

Gracias por tu interés. Este documento explica cómo preparar el entorno, qué
convenciones seguimos y cómo proponer cambios.

## Código de conducta

Al participar aceptas el [Código de conducta](./CODE_OF_CONDUCT.md).

## Requisitos

- Node.js ≥ 22 y pnpm ≥ 12 (`corepack enable`).
- Docker + Docker Compose para el stack completo.
- Opcional: runtime de agentes (opencode, Claude Code o Codex) para ejecuciones reales.

## Puesta en marcha

```bash
git clone git@github.com:protongit/factoria-agentes.git
cd factoria-agentes
pnpm install
cp .env.example .env
pnpm typecheck
pnpm test
```

Con contenedores:

```bash
docker compose up -d --build
docker compose exec api pnpm --filter @factoria/db db:migrate
```

- Web: http://localhost:8088
- API: http://localhost:4000/api/health

Nunca commitees tu `.env`: contiene secretos (claves de proveedores, JWT y la
clave de cifrado). Usa `.env.example` como plantilla.

## Estructura del monorepo

| Ruta | Contenido |
|---|---|
| `apps/web` | SPA React + Vite + React Flow. |
| `apps/api` | API Fastify (REST, SSE/WS, auth JWT). |
| `apps/worker` | Orquestador BullMQ y ejecutores. |
| `apps/mcp` | Servidor Project Info MCP (stdio). |
| `packages/shared` | Enums, tipos y schemas Zod. |
| `packages/db` | Esquema Drizzle y migraciones. |
| `packages/core` | Dominio y orquestación (grafo, contratos, verificación, RAG). |
| `packages/executors` | Adaptadores OpenCode/ACP/CLI y mock. |
| `docs/` | Especificación, arquitectura y guías. |

Lee [`AGENTS.md`](./AGENTS.md) y [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
antes de tocar código.

## Convenciones

- TypeScript en todo el monorepo. Los paquetes `@factoria/*` son *source-first*
  (exportan `./src/index.ts`); no hace falta compilarlos para consumirlos.
- Valida entradas con **Zod** (`packages/shared`) y no dupliques enums: impórtalos
  desde `@factoria/shared`.
- Cambios de esquema → migración Drizzle (`pnpm db:generate`).
- Estilo: Prettier (`.prettierrc`) y oxlint (`pnpm lint`).
- Sin comentarios superfluos: el código debe explicarse solo.
- Alinea siempre **prompt** y **permisos** de los subagentes: los permisos mandan.

## Comprobaciones antes de enviar un PR

```bash
pnpm typecheck   # obligatorio
pnpm lint        # obligatorio
pnpm test        # obligatorio
```

Si el cambio afecta a la interfaz, recorre el caso de uso completo en el
navegador y revisa la consola (ver el protocolo de pruebas de `AGENTS.md`).

## Pull requests

1. Crea una rama descriptiva: `feat/…`, `fix/…`, `docs/…`, `refactor/…`.
2. Haz commits pequeños y con mensajes en imperativo (`añade`, `corrige`, `documenta`).
3. Rellena la plantilla del PR: qué cambia, por qué y cómo se ha probado.
4. Mantén el PR enfocado; separa refactors de cambios funcionales.
5. Actualiza `docs/` y `CHANGELOG.md` si cambia el comportamiento o el diseño.

## Reportar fallos y proponer ideas

Usa las plantillas de *issues* del repositorio. Para vulnerabilidades, sigue
[`SECURITY.md`](./SECURITY.md) y no abras un issue público.
