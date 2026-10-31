# Documentación

Índice de la documentación de Factoría de Agentes. Empieza por la
[especificación](./SPEC.md) y la [arquitectura](./ARCHITECTURE.md) si vas a
tocar código; si solo quieres usar la aplicación, ve a la
[guía de usuario](./GUIA-DE-USUARIO.md).

## Producto y uso

| Documento | Contenido |
|---|---|
| [GUIA-DE-USUARIO.md](./GUIA-DE-USUARIO.md) | Guía paso a paso para cualquier persona, sin conocimientos técnicos. |
| [manual-usuario.html](./manual-usuario.html) | Manual en HTML con capturas reales (`docs/manual/`). |
| [SPEC.md](./SPEC.md) | Especificación funcional: qué hace y para quién. |
| [FLOWS.md](./FLOWS.md) | Flujos de trabajo y plantillas de Karajan. |
| [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) | Fases, estado y desviaciones conocidas. |
| [INCIDENT-FETCH-FAILED.md](./INCIDENT-FETCH-FAILED.md) | Informe del incidente `fetch failed` en ejecuciones largas (causa y corrección). |

## Diseño técnico

| Documento | Contenido |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Capas, stack, paquetes e infraestructura. |
| [DOMAIN-MODEL.md](./DOMAIN-MODEL.md) | Entidades, campos y relaciones. |
| [ORCHESTRATION.md](./ORCHESTRATION.md) | Scheduler durable, grafo y ejecución. |
| [HARNESS-AND-CONTRACTS.md](./HARNESS-AND-CONTRACTS.md) | Harness, subagentes y contratos. |
| [RAG-AND-MEMORY.md](./RAG-AND-MEMORY.md) | Project Info MCP, RAG y memoria. |
| [OBSERVABILITY.md](./OBSERVABILITY.md) | Eventos, trazas, tokens y catch-up. |
| [CONTAINERS-AND-GIT.md](./CONTAINERS-AND-GIT.md) | Contenedores por proyecto y credenciales Git. |

## Método y gobernanza

| Documento | Contenido |
|---|---|
| [GATES-AND-SENTINEL.md](./GATES-AND-SENTINEL.md) | Gates deterministas y Sentinel. |
| [GOVERNANCE.md](./GOVERNANCE.md) | Ledger encadenado por hash y ADRs. |

## Contribuir

- [CONTRIBUTING.md](../CONTRIBUTING.md) — entorno, convenciones y PRs.
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) — normas de convivencia.
- [SECURITY.md](../SECURITY.md) — cómo reportar vulnerabilidades.
- [CHANGELOG.md](../CHANGELOG.md) — historial de versiones.
- [AGENTS.md](../AGENTS.md) — guía para agentes de IA que trabajen en el repo.
