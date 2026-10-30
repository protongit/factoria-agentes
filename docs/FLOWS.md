# Flujos de trabajo

Además de las plantillas propias del proyecto, la plataforma incluye los seis **pipelines de Karajan v4** (`https://kj-code.com/docs/guides/flows/`) como plantillas de sistema (categoría `karajan`) en `apps/api/src/lib/templates.ts`. Se crean desde **Flujos de trabajo → Usar plantilla**.

## Mapeo Karajan → nodos de la plataforma

| Karajan | Plantilla | Secuencia |
|---|---|---|
| 1. Minimal — just code (`kj code`) | **Karajan · 1. Mínimo — solo código** | `start → coder(task) → end` |
| 2. Code + review loop (`kj run`) | **Karajan · 2. Código + bucle de revisión** | `start → coder(task, loop) → review_gate → (fallo) coder / (éxito) end` |
| 3. Standard (SonarQube) | **Karajan · 3. Estándar (con SonarQube)** | `coder → sonar(gate) → review_gate → tester(gate) → security(gate) → end`, cada gate devuelve al coder si falla |
| 4. Intelligent (Triage + Solomon) | **Karajan · 4. Inteligente (Triage + Solomon)** | `triage(condition) → planner(task) → coder → sonar → review_gate → tester → security → solomon(human_approval) → end` |
| 5. BecarIA Gateway (PR as source of truth) | **Karajan · 5. BecarIA (PR como fuente de verdad)** | `triage → planner → coder → push_repo → sonar → review_gate → tester → security → end` |
| 6. Planning Game | **Karajan · 6. Planning Game (gestión completa)** | `implement → sonar → review_gate → tester → security → contract_check → push_repo → notify → end` |

## Notas de implementación

- **Reviewer cross-AI**: `review_gate` usa un modelo de familia distinta al autor (derivado del predecesor) y ata el veredicto al `sha256` del diff.
- **Triage**: nodo `condition`; asigna un modelo al nodo para el enrutado por IA (compleja → planner, simple → coder).
- **SonarQube / Security**: nodos `gate` (revisor IA o comando determinista vía `harness.validationCommand`).
- **Solomon**: se modela como `human_approval` ante anomalías (deriva de alcance, progreso estancado).
- **BecarIA / Planning Game**: el push y la PR se aproximan con el nodo `push_repo`; el estado del tablero, con `notify`.
- Los nodos no traen `modelId`/`subagentId`: se asignan por paso en el editor.
