# Harness, subagentes y contratos

## Harness

El **harness** es la infraestructura que envuelve al modelo y le da capacidad de actuar: herramientas, ejecución de código, lectura/escritura de ficheros, servidores MCP y **reglas de seguridad** (permisos).

Se define **por paso** (`WorkflowNode.harness`), con un valor por defecto a nivel de proyecto (`Project.defaultHarness`). Un paso puede sobreescribirlo.

### Esquema

```jsonc
{
  "executor": "opencode",            // opencode | acp | cli
  "agentProfile": "build",           // build | plan | custom (perfil del ejecutor)
  "subagentId": "sub_revisor",       // subagente asignado (opcional)
  "permissions": {
    "read": "allow",
    "edit": "ask",                   // allow | ask | deny
    "bash": { "*": "ask", "git diff": "allow" },
    "webfetch": "deny",
    "task": { "*": "deny", "revisor": "allow" }  // delegación a subagentes
  },
  "mcpServers": ["project-info", "browsermcp"],
  "skills": ["opencode-skill-x"],
  "rag": { "enabled": true, "topK": 8, "rerank": true },
  "rules": { "allowNetwork": false, "workspaceOnly": true },
  "validationCommand": "npm test",
  "env": { "CI": "1" }
}
```

### Principio de seguridad

> El prompt define la **intención**; los permisos definen lo que de verdad puede **hacer**. Deben estar **alineados**.

El harness materializa los permisos en el formato nativo del ejecutor (p. ej. `permission` en opencode).

## Subagentes

Un **subagente** es un proceso aparte con su propio contexto, system prompt, modelo y permisos. Se define en el catálogo (módulo *Subagentes*) y se **asigna a las tareas**.

### Campos

`name`, `description` (cuándo usarlo), `instructions`, `category`, `defaultModelId`, `temperature`, `permissions`, `allowedTools`, `outputContract`, `canDelegateTo`, `maxDepth`, `skills`, `mcpServers`, `mode`.

### Categorías

- **read** — explorador, revisor, auditor-seguridad, sintetizador, investigador-de-alucinaciones.
- **write** — cazador-de-bugs, refactorizador, escritor-de-tests, documentador.
- **knowledge** — investigador-de-docs.
- **orchestrator** — orquestador (delega, no programa).

### Plantillas incluidas (seed)

`orquestador`, `explorador`, `revisor`, `auditor-seguridad`, `investigador-de-docs`, `documentador`, `sintetizador`, `probador-de-regresion`, `investigador-de-alucinaciones`, `cazador-de-bugs`, `refactorizador`, `escritor-de-tests`.

### Permisos mínimos (plantilla)

| Subagente | Lee | Edita | Bash | Web/MCP | Riesgo |
|---|---|---|---|---|---|
| orquestador | Sí | No | No | No | Bajo |
| explorador | Sí | No | Opcional | No | Bajo |
| revisor | Sí | No | `git diff` | No | Bajo |
| auditor-seguridad | Sí | No | Opcional | Opcional | Medio |
| investigador-de-docs | Sí | No | No | Sí | Medio |
| documentador | Sí | Sí | Opcional | Opcional | Medio |
| sintetizador | Sí | No | No | No | Bajo |
| probador-de-regresion | Sí | No | Test runner | No | Medio |
| investigador-de-alucinaciones | Sí | No | No | No | Bajo |
| cazador-de-bugs | Sí | Sí | Sí | No | Alto |
| refactorizador | Sí | Sí | Sí | No | Alto |
| escritor-de-tests | Sí | Sí | Test runner | No | Alto |

El **orquestador** requiere un permiso especial para invocar subagentes: `permission.task` en opencode, `max_depth`/`max_threads` en Codex.

### Contrato de salida común

```markdown
## Hallazgos

- Severidad:
- Evidencia:
- Fichero/línea:
- Confianza:
- Acción recomendada:

## Qué no he podido comprobar

## Siguiente paso
```

### Materialización a formatos de ejecutor

El catálogo genera los ficheros nativos del ejecutor en el workspace del proyecto:

- **opencode**: `.opencode/agent/<name>.md` con frontmatter (`mode: subagent`, `model`, `permission`) e instrucciones.
- **Claude Code**: `.claude/agents/<name>.md`.
- **Codex**: `.codex/agents/<name>.toml`.

### Niveles de subagente

1. **Macro (plataforma)**: ramas paralelas del grafo = `StepRun` independientes.
2. **Sub-workflow**: un nodo invoca otro workflow (recursión acotada).
3. **Micro (interno del agente)**: delegación nativa dentro de un paso (p. ej. *Task* de opencode); por defecto read-only y con los tokens agregados al paso padre.

## Contratos

Los **contratos** son los criterios de aceptación que el programa debe cumplir. Se definen a nivel de proyecto y actúan como **gate**: el proyecto no se finaliza hasta satisfacerlos **todos**.

### Campos

`title`, `criterion` (texto), `verification` (`command` | `llm` | `manual`), `verificationConfig` (jsonb), `status` (`pending` | `satisfied` | `failed`), `evidence` (jsonb), `order`.

### Verificación

- **command**: se ejecuta un comando; el código de salida determina el cumplimiento.
- **llm**: un juez IA evalúa el criterio contra la evidencia (salida, diff, documentación) con structured output.
- **manual**: verificación/aprobación por parte del usuario.

Los contratos también pueden aplicarse como **guardrails** de entrada/salida en pasos concretos (nodo `contract_check`).
