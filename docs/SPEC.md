# Factoría de Agentes — Especificación

Plataforma web multiusuario para **orquestar agentes de IA que desarrollan software de forma automatizada**. El usuario define un proyecto (objetivo, funcionalidades, stack, contratos, documentación), un flujo de trabajo (grafo de tareas) y lanza su ejecución. La plataforma reparte las tareas entre agentes y subagentes, verifica los resultados contra los contratos y ofrece observabilidad total e histórica.

## 1. Objetivo

Automatizar el ciclo de desarrollo de un programa de software: desde la definición hasta el cumplimiento de los criterios de aceptación (contratos), con intervención humana puntual en los puntos que el usuario decida.

## 2. Usuarios y roles

- **admin**: gestiona proveedores/modelos globales, usuarios y ajustes del sistema.
- **member**: gestiona sus propios proyectos, flujos y ejecuciones.

Autenticación por email + contraseña (sesión en cookie httpOnly). Multiusuario.

## 3. Conceptos clave

| Concepto | Definición |
|---|---|
| **Proveedor** | Servicio de IA (Anthropic, OpenAI, OpenRouter…) con su credencial de acceso. |
| **Modelo** | Modelo de un proveedor, con las **capacidades** que soporta (código, visión, razonamiento, tool-use, structured output, contexto largo, embeddings, rerank, generación de imágenes). |
| **Subagente** | Trabajador especializado con su propio contexto, system prompt, modelo y **permisos**. Se asigna a las tareas. |
| **Proyecto** | El software a desarrollar: objetivo, funcionalidades, stack, directorio de trabajo, contratos, documentación, flujo y observabilidad. |
| **Contrato** | Criterio de aceptación que el programa debe cumplir. Los contratos son un **gate**: el proyecto no se finaliza hasta satisfacerlos todos. |
| **Harness** | Infraestructura que envuelve al LLM y le da capacidad de actuar en el entorno (herramientas, ejecución, lectura de ficheros, MCP, reglas de seguridad). Se define **por paso**, con un valor por defecto a nivel de proyecto. |
| **Flujo de trabajo** | Grafo (DAG con ciclos acotados) de tareas: fan-out (ramas en paralelo), fan-in (joins), ramas condicionales y bucles de corrección. |
| **PasoTarea** (`StepRun`) | Ejecución de un nodo del flujo por un agente/subagente. |
| **Asistente de proyecto** | Agente + modelo asignado a nivel de proyecto que analiza, ayuda, mantiene la visión general y genera resúmenes de ausencia. |

## 4. Módulos funcionales

1. **Auth y usuarios** — registro/login, roles.
2. **Proveedores y modelos** — CRUD, credenciales cifradas, asignación de capacidades, test de conexión.
3. **Subagentes** — catálogo de trabajadores especializados, plantillas, materialización a los formatos de cada ejecutor y asignación a tareas.
4. **Proyectos** — CRUD con pestañas: General · Funcionalidades · Contratos · Flujo · Documentación · Observabilidad · Coste.
5. **Flujos de trabajo** — editor visual de grafo (DAG), versionado, plantillas y variables.
6. **Ejecuciones** — lanzar/monitorizar runs en vivo, con aprobaciones humanas, catch-up e histórico.
7. **Observabilidad** — eventos en vivo, trazas estructuradas, token counter y coste, resúmenes.
8. **Asistente de proyecto** — chat, propuestas de cambios en la definición, generación de imágenes, resúmenes de ausencia.
9. **Configuración** — perfiles de ejecutor, ajustes del sistema.

## 5. Requisitos funcionales (resumen)

- **RF-1** Alta de proveedores y modelos con capacidades.
- **RF-2** CRUD de proyectos con todos sus atributos (objetivo, funcionalidades, stack, directorio de trabajo, contratos, harness, documentación de referencia, documentación generada, flujo, logs/observabilidad).
- **RF-3** CRUD de flujos como grafo; clonar flujos existentes o partir de plantillas.
- **RF-4** Asignar a cada paso: modelo, subagente, descripción de la tarea, resultado esperado y harness.
- **RF-5** Ejecutar el flujo con agentes/subagentes (opencode y otros vía adapters).
- **RF-6** Paralelismo real (fan-out), joins (fan-in) y bucles condicionales acotados.
- **RF-7** Aislamiento de escrituras por directorio de trabajo; git worktrees cuando dos tareas concurrentes comparten directorio.
- **RF-8** Verificación híbrida del resultado esperado (comando determinista / juez IA / aprobación humana).
- **RF-9** Gate de contratos para la finalización del proyecto.
- **RF-10** Ejecución durable y desacoplada del navegador; catch-up del histórico al reconectar (eventos + resumen IA).
- **RF-11** Acceso de agentes y subagentes a toda la documentación vía **Project Info MCP** y **RAG** (embeddings + rerank configurables).
- **RF-12** Asistente de proyecto: chat, propuestas de definición, generación de imágenes (adjuntadas al proyecto) y resúmenes de ausencia.
- **RF-13** Token counter por paso/run/proyecto y presupuesto.
- **RF-14** Observabilidad con trazas estructuradas y stream en vivo.

## 6. Requisitos no funcionales

- **Multiusuario** con roles y aislamiento de datos por propietario/organización.
- **Durable**: los runs sobreviven a cierre de sesión del usuario y a reinicio del servidor/worker.
- **Seguridad**: credenciales cifradas en reposo (AES-256-GCM), permisos mínimos por subagente, sandbox por run (opcional).
- **Contenerizado**: `docker-compose` con servicios separados en red privada.
- **Extensible**: adapters de ejecutor intercambiables (opencode / ACP / CLI).
- **i18n**: español e inglés.

## 7. Fuera de alcance (inicial)

- Colaboración simultánea en tiempo real dentro del mismo editor de flujos.
- Ejecución distribuida multi-nodo (se contempla escalado horizontal del worker).
- Time-travel/replay desde checkpoints (mejora futura).

## Documentos relacionados

- [`DOMAIN-MODEL.md`](./DOMAIN-MODEL.md) — entidades y relaciones.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — capas, stack e infraestructura.
- [`ORCHESTRATION.md`](./ORCHESTRATION.md) — motor, DAG, durabilidad.
- [`HARNESS-AND-CONTRACTS.md`](./HARNESS-AND-CONTRACTS.md) — harness, subagentes, permisos y contratos.
- [`RAG-AND-MEMORY.md`](./RAG-AND-MEMORY.md) — Project Info MCP, RAG y memoria.
- [`OBSERVABILITY.md`](./OBSERVABILITY.md) — eventos, trazas, tokens y catch-up.
- [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md) — fases y tareas.
