# Modelo de dominio

Entidades, campos y relaciones de Factoría de Agentes. Tipos de referencia: se implementan con **Drizzle ORM + PostgreSQL** en `packages/db`.

## Diagrama de relaciones (resumen)

```
User 1─* Provider 1─* Model
User 1─* Subagent
User 1─* Workflow 1─* WorkflowVersion 1─* WorkflowNode *─* WorkflowEdge
                                    │
User 1─* Project ───────────────────┘ (usa/snapshot del flujo)
        │  ├─* ProjectFeature
        │  ├─* Contract
        │  ├─* Document 1─* DocumentChunk(embedding)
        │  ├─* LongTermMemory
        │  └─* WorkflowRun 1─* StepRun 1─* RunEvent
        │                   └─* TraceSpan
        │                   └─* RunSummary
        └─* AssistantMessage / AssistantProposal
WorkflowRun 1─* UsageRecord
Project 1─* ProjectBudget
```

## Entidades

### Identity

| Entidad | Campos |
|---|---|
| **User** | `id`, `email` (único), `passwordHash`, `name`, `role` (`admin`\|`member`), `createdAt` |

### Catálogo de IA

| Entidad | Campos |
|---|---|
| **Provider** | `id`, `ownerId` (null = global), `name`, `baseUrl`, `apiKeyEncrypted`, `createdAt` |
| **Model** | `id`, `providerId`, `modelId` (p. ej. `anthropic/claude-sonnet-4-6`), `displayName`, `contextWindow`, `capabilities` (jsonb), `costInputPer1M`, `costOutputPer1M`, `enabled` |

`capabilities` (jsonb, lista): `code`, `vision`, `reasoning`, `toolUse`, `structuredOutput`, `longContext`, `embeddings`, `rerank`, `imageGeneration`.

### Subagentes

| Entidad | Campos |
|---|---|
| **Subagent** | `id`, `ownerId` (null = plantilla de sistema), `name`, `description`, `instructions` (system prompt), `category` (`read`\|`write`\|`knowledge`\|`orchestrator`), `defaultModelId`, `temperature`, `permissions` (jsonb: `{read, edit, bash, web}`), `allowedTools` (jsonb), `outputContract` (texto/schema), `canDelegateTo` (jsonb de ids), `maxDepth`, `skills` (jsonb), `mcpServers` (jsonb), `mode` (`subagent`\|`primary`), `createdAt` |

### Proyecto

| Entidad | Campos |
|---|---|
| **Project** | `id`, `ownerId`, `name`, `programName`, `objective`, `description`, `stack` (jsonb), `workspaceRoot`, `status` (`draft`\|`active`\|`paused`\|`completed`\|`failed`), `embeddingModelId`, `rerankModelId`, `assistantModelId`, `assistantHarness` (jsonb), `assistantInstructions`, `assistantSessionRef`, `defaultHarness` (jsonb), `createdAt`, `updatedAt` |
| **ProjectFeature** | `id`, `projectId`, `title`, `description`, `priority`, `status` |
| **Contract** | `id`, `projectId`, `title`, `criterion`, `verification` (`command`\|`llm`\|`manual`), `verificationConfig` (jsonb), `status` (`pending`\|`satisfied`\|`failed`), `evidence` (jsonb), `order` |
| **Document** | `id`, `projectId`, `type` (`reference`\|`generated`\|`image`\|`sketch`), `title`, `mimeType`, `storagePath`, `textExtracted`, `indexedStatus` (`pending`\|`indexed`\|`failed`), `source` (`uploaded`\|`generated`), `createdAt` |
| **DocumentChunk** | `id`, `documentId`, `projectId`, `chunkIndex`, `content`, `embedding` (vector), `metadata` (jsonb) |

### Flujo de trabajo

| Entidad | Campos |
|---|---|
| **Workflow** | `id`, `ownerId`, `name`, `description`, `isTemplate`, `published`, `version`, `variables` (jsonb), `createdAt` |
| **WorkflowVersion** | `id`, `workflowId`, `version`, `graph` (jsonb snapshot), `createdAt` |
| **WorkflowNode** | `id`, `workflowId`, `key`, `type` (`start`\|`task`\|`gate`\|`join`\|`orchestrator`\|`condition`\|`loop`\|`subworkflow`\|`human_approval`\|`contract_check`\|`push_repo`\|`documentation`\|`notify`\|`end`), `name`, `description`, `modelId`, `subagentId`, `expectedResult`, `harness` (jsonb), `workingDir`, `joinPolicy` (`all`\|`any`), `loopGuard` (jsonb), `errorHandling` (jsonb), `dataMapping` (jsonb), `usesWorkflowId`, `position` (jsonb) |
| **WorkflowEdge** | `id`, `workflowId`, `fromNodeKey`, `toNodeKey`, `condition` (jsonb) |

### Ejecución

| Entidad | Campos |
|---|---|
| **WorkflowRun** | `id`, `projectId`, `workflowId`, `graphSnapshot` (jsonb), `status` (`queued`\|`running`\|`paused`\|`succeeded`\|`failed`\|`cancelled`), `currentNodes` (jsonb), `triggeredBy`, `startedAt`, `finishedAt` |
| **StepRun** | `id`, `runId`, `nodeKey`, `iteration`, `status` (`pending`\|`ready`\|`running`\|`waiting_approval`\|`succeeded`\|`failed`\|`skipped`), `subagentId`, `modelId`, `executor`, `sessionRef`, `worktreeRef`, `promptSent`, `verdict` (jsonb), `attempts`, `error`, `startedAt`, `finishedAt` |
| **StepRunDependency** | `runId`, `stepRunId`, `dependsOnStepRunId` (fan-in) |

### Observabilidad, coste y conocimiento

| Entidad | Campos |
|---|---|
| **RunEvent** | `id`, `runId`, `stepRunId` (nullable), `seq` (monótono por run), `level`, `source` (`orchestrator`\|`agent`\|`system`\|`tool`), `message`, `payload` (jsonb), `createdAt` |
| **TraceSpan** | `id`, `runId`, `stepRunId`, `parentId` (nullable), `kind`, `name`, `attributes` (jsonb), `inputTokens`, `outputTokens`, `cost`, `startedAt`, `endedAt` |
| **UsageRecord** | `id`, `runId`, `stepRunId`, `providerId`, `modelId`, `subagentId`, `kind` (`chat`\|`embedding`\|`rerank`\|`image`), `inputTokens`, `outputTokens`, `cachedTokens`, `reasoningTokens`, `cost`, `createdAt` |
| **ProjectBudget** | `id`, `projectId`, `limitUsd`, `softLimitUsd`, `alertedAt`, `period` |
| **LongTermMemory** | `id`, `scope` (`project`\|`assistant`\|`agent`), `projectId`, `subagentId`, `content`, `embedding` (vector), `metadata` (jsonb), `createdAt` |
| **AssistantMessage** | `id`, `projectId`, `role` (`user`\|`assistant`), `content`, `attachments` (jsonb), `createdAt` |
| **AssistantProposal** | `id`, `projectId`, `kind` (`features`\|`stack`\|`contracts`\|`objective`\|`workflow`\|`document`), `payload` (jsonb), `status` (`pending`\|`accepted`\|`rejected`), `createdAt`, `decidedAt` |
| **RunSummary** | `id`, `runId`, `projectId`, `fromSeq`, `toSeq`, `summary`, `modelId`, `createdAt` |

## Índices y restricciones relevantes

- `User.email` único.
- `(projectId, seq)` único en `RunEvent` para soportar el catch-up.
- `DocumentChunk.embedding` y `LongTermMemory.embedding` con índice `ivfflat`/`hnsw` de pgvector.
- `StepRun` con índice `(runId, nodeKey, iteration)`.
- Borrado en cascada por proyecto/run.

## Enumeraciones (fuente única en `packages/shared`)

Todas las enumeraciones anteriores viven en `packages/shared/src/enums.ts` y se usan tanto en el esquema Drizzle como en los schemas Zod de la API.
