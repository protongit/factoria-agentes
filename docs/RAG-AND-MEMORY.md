# RAG y memoria

## Project Info MCP

Servicio interno (`mcp-project`) que expone toda la información del proyecto a los agentes y subagentes mediante el **Model Context Protocol**. Es agnóstico del ejecutor: opencode, ACP y CLI pueden consumirlo.

### Tools / resources

| Tool | Descripción |
|---|---|
| `get_project` | Datos del proyecto (objetivo, stack, estado). |
| `list_features` | Funcionalidades y su estado. |
| `list_contracts` | Contratos y su estado. |
| `list_documents` | Documentos de referencia y generados. |
| `list_runs` | Ejecuciones del proyecto y su estado. |
| `get_run_log` | Eventos y errores de la última ejecución (o de `run_id`), con `seq`, nivel, origen y fecha. |
| `search_project_docs` | Búsqueda sobre la documentación del proyecto. |
| `search_memory` | Recuperación de memoria de largo plazo. |

Además se distribuye una **skill** de opencode que envuelve las llamadas más frecuentes.

## RAG

Indexado y recuperación de la documentación subida (referencia) y generada.

### Pipeline

1. **Extracción**: texto de PDF/Office/Markdown; OCR y *captioning* de imágenes y bocetos.
2. **Chunking**: fragmentos con solapamiento y metadatos (documento, sección, página).
3. **Embeddings**: modelo configurable (`Project.embeddingModelId`, capability `embeddings`).
4. **Índice**: `DocumentChunk.embedding` en **pgvector** (índice HNSW/IVFFlat).
5. **Recuperación**: top-K por similitud.
6. **Rerank**: modelo configurable (`Project.rerankModelId`, capability `rerank`).
7. **Inyección**: los fragmentos seleccionados se añaden al contexto del agente bajo demanda (tool `search_project_docs`), evitando inflar la ventana.

### Configuración

- `embeddingModelId`, `rerankModelId` por proyecto (de los modelos dados de alta).
- El harness de cada paso controla `rag { enabled, topK, rerank }`.

## Memoria

- **Corto plazo (working)**: contexto de la sesión en curso gestionado por el ejecutor (compaction).
- **Largo plazo**: `LongTermMemory` con embeddings, por ámbitos:
  - `project`: conocimiento acumulado del proyecto (decisiones, convenciones, lecciones).
  - `assistant`: memoria del asistente de proyecto.
  - `agent`: memoria específica de un subagente.
- Escritura: los pasos y el asistente pueden **recordar** hechos relevantes (tool `remember`).
- Lectura: tool `search_memory` y recuperación automática al iniciar pasos relacionados.

## Límites y buenas prácticas

- No volcar toda la documentación en el contexto: recuperar sólo lo relevante (RAG) para evitar degradación por exceso de contexto y consumo de tokens.
- Citar la fuente (documento/fragmento) en las respuestas del RAG.
- Versionar el índice por documento (`indexedStatus`) y reindexar al actualizar.
