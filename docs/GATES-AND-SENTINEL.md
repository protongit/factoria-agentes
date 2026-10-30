# Gates y Sentinel (método)

Porte nativo del método de Karajan v4. Principio: **el prompt define la intención; los gates deterministas (en git y en la base de datos) definen lo que de verdad se puede hacer**.

## Review gate cross-AI

- El revisor de un diff debe ser un modelo de **familia distinta** al autor (`selectReviewModel`, `packages/core/src/review.ts`).
- El veredicto se ata al `sha256` del diff exacto (`hashDiff`) y se guarda en `.factoria/reviews/<sha256>.json` y en la tabla `review_verdicts`.
- Nodo de flujo `review_gate`: revisa el diff del workspace; si el revisor rechaza, el flujo vuelve a implementar (bucle acotado).
- `reviewDiff` (en `ai.ts`) es **fail-closed**: si el revisor no está disponible, rechaza.

## Gates en git

`installGitHooks` materializa en el workspace:

- `.factoria/hooks/pre-commit` → `review-check`: exige un veredicto aprobado para los bytes staged.
- `.factoria/hooks/commit-msg` → Conventional Commits, límite de longitud y **prohibición de atribución de IA**.
- `.factoria/hooks/pre-push` → no se empuja con cambios sin veredicto.

## Sentinel (guardarraíles síncronos)

`packages/core/src/sentinel.ts` evalúa cada llamada a herramienta antes de ejecutarse. Gates:

| Gate | Bloquea |
|---|---|
| `card-first` | editar código sin tarjeta de trabajo |
| `rag-first` | editar una zona sobre la que el RAG no respondió |
| `bash-write` | escribir ficheros del repo por Bash |
| `discard` | `git checkout --`, `git reset --hard`, `git clean`, `stash drop`… |
| `governance` | editar `policy.yml`, `rules.yml`, `AGENTS.md`, hooks |
| `commit-gate` | `git commit --no-verify`, `core.hooksPath` |
| `cross-lane` | escribir fuera del worktree propio |
| `attribution` | introducir atribución de IA |

Los gates se habilitan por paso con `harness.gates`. Además, `policy.yml`/`rules.yml` se evalúan por encima (`evaluatePolicy`): una regla `class: security` **no tiene escape**.

## Reglas compiladas

`extractRulesFromMarkdown` extrae reglas de `AGENTS.md`; `compileRuleSkeleton` las propone sin llamar a ningún modelo; `ruleCoverage` señala reglas sin gate u obsoletas. La aprobación es un acto humano (`POST /policies/:ruleId/approve`).

## Claims (anti-alucinación)

`evaluateClaims` contrasta afirmaciones duras del agente («los tests pasan») contra el transcript real de la sesión. Una afirmación desmentida por su propio terminal es una alucinación probada y bloquea el paso.
