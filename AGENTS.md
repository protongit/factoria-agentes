# AGENTS.md

Guía para agentes de IA que trabajen en el repositorio **Factoría de Agentes**.

## Contexto del proyecto

Plataforma web multiusuario para orquestar agentes de IA que desarrollan software. Antes de tocar código, lee la especificación en `docs/` (empieza por `SPEC.md` y `ARCHITECTURE.md`).

## Estructura y convenciones

- Monorepo **pnpm workspaces + Turborepo**.
- Paquetes internos `@factoria/*` son **source-first**: exportan TypeScript directamente (`exports: "./src/index.ts"`).
- Node ≥ 22; se ejecuta TypeScript con **tsx** (apps) y **Vite** (web).
- Tipos y validación: **Zod** + enums compartidos en `packages/shared`. No duplicar enums: importar de `@factoria/shared`.
- Base de datos: **Drizzle ORM** en `packages/db`. Cambios de esquema → migración (`pnpm db:generate`).
- Sin comentarios superfluos. Seguir el estilo existente.

## Comandos

```bash
pnpm install          # dependencias
pnpm typecheck        # typecheck de todo el monorepo
pnpm lint             # (pendiente de configurar)
pnpm test             # tests unitarios (vitest)
pnpm db:generate      # generar migraciones Drizzle
pnpm db:migrate       # aplicar migraciones
docker compose up -d --build
```

## Protocolo de pruebas (obligatorio)

Durante el desarrollo, **tras cada fase con interfaz de usuario**, validar casos de uso completos usando el MCP **browsermcp**:

1. Levantar el stack (`docker compose up -d --build` o `pnpm dev`).
2. Navegar a la app (http://localhost:8080 o http://localhost:5173).
3. Recorrer el caso de uso de la fase de principio a fin (p. ej. registro → login → crear proyecto → editar flujo → lanzar run → aprobar → ver histórico).
4. Revisar la consola del navegador (`browser_get_console_logs`) y capturar pantallas de cada paso clave.
5. Corregir cualquier error de usabilidad o de consola antes de dar la fase por terminada.

Casos de uso de referencia (acumulativos):

- Alta de proveedor y modelo con capacidades.
- Crear/editar proyecto (funcionalidades, contratos, documentación).
- Editorial del flujo (DAG) con nodos y conexiones.
- Ejecución de un run, aprobación humana y observabilidad en vivo.
- Catch-up: cerrar sesión durante un run y ver el resumen al volver.

## Definición de "hecho"

1. `pnpm typecheck` sin errores.
2. `pnpm test` en verde.
3. Casos de uso de la fase recorridos con browsermcp sin errores de consola.
4. `docs/` actualizado si cambia el diseño.

## Seguridad

- Nunca commitear secretos. Usar `.env` (no versionado).
- Las claves de proveedores se cifran en reposo (AES-256-GCM) con `SECRETS_ENCRYPTION_KEY`.
- Alinear **prompt** y **permisos** de cada subagente: los permisos son los que mandan.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
