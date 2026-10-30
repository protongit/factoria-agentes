export interface ProviderEndpoint {
  baseUrl: string;
  apiKey: string;
}

export type AiEvent = (event: { type: string; message?: string; payload?: unknown }) => void;

export const EMBEDDING_DIMENSIONS = 1536;

/** Ajusta (rellena con ceros o recorta) un vector a la dimensión del índice. */
export function fitDimensions(vec: number[], dims = EMBEDDING_DIMENSIONS): number[] {
  if (vec.length === dims) return vec;
  if (vec.length > dims) return vec.slice(0, dims);
  return [...vec, ...new Array(dims - vec.length).fill(0)];
}

async function postJson<T>(url: string, apiKey: string, body: unknown, timeoutMs = 120000): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Proveedor respondió ${resp.status}: ${detail.slice(0, 300)}`);
  }
  return (await resp.json()) as T;
}

function rawModelName(modelId: string): string {
  return modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;
}

/** Genera embeddings con un endpoint OpenAI-compatible (`POST /embeddings`). */
export async function embedTexts(
  provider: ProviderEndpoint,
  modelId: string,
  inputs: string[],
): Promise<number[][]> {
  const base = provider.baseUrl.replace(/\/$/, "");
  const json = await postJson<{ data: { embedding: number[] }[] }>(`${base}/embeddings`, provider.apiKey, {
    model: rawModelName(modelId),
    input: inputs,
  });
  return json.data.map((d) => d.embedding);
}

export interface RerankResult {
  index: number;
  score: number;
}

/** Rerank con un endpoint compatible (`POST /rerank`). Devuelve el orden original si falla. */
export async function rerank(
  provider: ProviderEndpoint,
  modelId: string,
  query: string,
  documents: string[],
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];
  const base = provider.baseUrl.replace(/\/$/, "");
  try {
    const json = await postJson<{ results?: { index: number; relevance_score?: number; score?: number }[] }>(
      `${base}/rerank`,
      provider.apiKey,
      { model: rawModelName(modelId), query, documents, top_n: documents.length },
    );
    const rows = json.results ?? [];
    return rows.map((r) => ({ index: r.index, score: r.relevance_score ?? r.score ?? 0 }));
  } catch {
    return documents.map((_, index) => ({ index, score: 1 - index / Math.max(documents.length, 1) }));
  }
}

export interface ChatOptions {
  provider: ProviderEndpoint;
  modelId: string;
  system?: string;
  prompt: string;
  json?: boolean;
  temperature?: number;
  onEvent?: AiEvent;
  timeoutMs?: number;
}

/** Chat completion OpenAI-compatible. Si `json`, fuerza respuesta JSON. */
export async function chat(options: ChatOptions): Promise<string> {
  const base = options.provider.baseUrl.replace(/\/$/, "");
  const messages: { role: string; content: string }[] = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: options.prompt });

  options.onEvent?.({ type: "log", message: `chat ${rawModelName(options.modelId)}` });

  const body: Record<string, unknown> = {
    model: rawModelName(options.modelId),
    messages,
    temperature: options.temperature ?? 0.2,
  };
  if (options.json) body.response_format = { type: "json_object" };

  const json = await postJson<{ choices: { message: { content: string } }[] }>(
    `${base}/chat/completions`,
    options.provider.apiKey,
    body,
    options.timeoutMs ?? 180000,
  );
  const content = json.choices?.[0]?.message?.content ?? "";
  options.onEvent?.({ type: "text", payload: content });
  return content;
}

/** Chat que devuelve JSON validado mínimamente contra una forma esperada. */
export async function chatJson<T>(options: ChatOptions): Promise<T> {
  const content = await chat({ ...options, json: true });
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("El modelo no devolvió JSON válido");
  }
}

export interface JudgeInput {
  expectedResult?: string;
  output: string;
  diff?: string;
  contracts?: string[];
}

export interface JudgeVerdict {
  passed: boolean;
  reasons: string[];
  evidence?: unknown;
}

/** Juez IA: evalúa si la salida del paso cumple el resultado esperado. */
export async function judge(
  provider: ProviderEndpoint,
  modelId: string,
  input: JudgeInput,
  onEvent?: AiEvent,
): Promise<JudgeVerdict> {
  const prompt = [
    "Evalúa si el resultado del paso de desarrollo cumple el resultado esperado.",
    input.expectedResult ? `Resultado esperado:\n${input.expectedResult}` : "",
    input.contracts && input.contracts.length ? `Contratos aplicables:\n- ${input.contracts.join("\n- ")}` : "",
    `Salida del agente:\n${input.output.slice(0, 4000)}`,
    input.diff ? `Diff (recortado):\n${input.diff.slice(0, 4000)}` : "",
    'Responde SOLO con un JSON: {"passed": boolean, "reasons": string[]}',
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await chatJson<{ passed?: boolean; reasons?: string[] }>({
      provider,
      modelId,
      system: "Eres un evaluador riguroso. Devuelves únicamente JSON válido.",
      prompt,
      json: true,
      temperature: 0,
      onEvent,
    });
    return {
      passed: Boolean(result.passed),
      reasons: Array.isArray(result.reasons) ? result.reasons : [String(result.passed)],
      evidence: { judge: rawModelName(modelId) },
    };
  } catch (error) {
    // Fail-closed: si el juez no está disponible, no se da por aprobado.
    return {
      passed: false,
      reasons: [`Juez no disponible: ${error instanceof Error ? error.message : error}`],
      evidence: { judge: "error" },
    };
  }
}

export interface DiffReviewInput {
  diff: string;
  expectedResult?: string;
  contracts?: string[];
  authorModel?: string;
}

export interface DiffReviewVerdict {
  verdict: "approved" | "rejected";
  summary: string;
  confidence: number;
  findings: string[];
}

/**
 * Revisión cross-AI de un diff. Debe invocarse con un modelo de familia distinta
 * al autor (ver `selectReviewModel`). Fail-closed: si falla, se rechaza.
 */
export async function reviewDiff(
  provider: ProviderEndpoint,
  modelId: string,
  input: DiffReviewInput,
  onEvent?: AiEvent,
): Promise<DiffReviewVerdict> {
  const prompt = [
    "Eres un revisor de código independiente. Revisas el diff de OTRO agente y emites un veredicto.",
    input.expectedResult ? `Resultado esperado:\n${input.expectedResult}` : "",
    input.contracts && input.contracts.length ? `Contratos aplicables:\n- ${input.contracts.join("\n- ")}` : "",
    input.authorModel ? `Autor: ${input.authorModel} (debes ser un revisor distinto).` : "",
    `Diff a revisar:\n${input.diff.slice(0, 12000) || "(diff vacío)"}`,
    'Responde SOLO JSON: {"verdict":"approved|rejected","summary":"...","confidence":0..1,"findings":["..."]}',
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await chatJson<Partial<DiffReviewVerdict>>({
      provider,
      modelId,
      system: "Revisor riguroso e independiente. Solo devuelves JSON válido.",
      prompt,
      json: true,
      temperature: 0,
      onEvent,
    });
    const verdict = result.verdict === "approved" ? "approved" : "rejected";
    return {
      verdict,
      summary: String(result.summary ?? (verdict === "approved" ? "Aprobado" : "Rechazado")),
      confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
      findings: Array.isArray(result.findings) ? result.findings.map(String) : [],
    };
  } catch (error) {
    return {
      verdict: "rejected",
      summary: `Revisor no disponible: ${error instanceof Error ? error.message : error}`,
      confidence: 0,
      findings: [],
    };
  }
}
