import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, SkeletonRows, Spinner, useConfirm, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";

const CAPABILITIES = ["code", "vision", "reasoning", "toolUse", "structuredOutput", "longContext", "embeddings", "rerank", "imageGeneration"];

export function Providers() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });

  const [pName, setPName] = useState("");
  const [pKey, setPKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [m, setM] = useState({ providerId: "", modelId: "", displayName: "", caps: [] as string[] });

  const invalidateProviders = () => qc.invalidateQueries({ queryKey: ["providers"] });
  const invalidateModels = () => qc.invalidateQueries({ queryKey: ["models"] });

  const addProvider = useMutation({
    mutationFn: () => api.createProvider({ name: pName, apiKey: pKey }),
    onSuccess: () => { setPName(""); setPKey(""); setShowKey(false); invalidateProviders(); toast("Proveedor añadido", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const addModel = useMutation({
    mutationFn: () => api.createModel({ providerId: m.providerId, modelId: m.modelId, displayName: m.displayName, capabilities: m.caps }),
    onSuccess: () => { setM({ providerId: "", modelId: "", displayName: "", caps: [] }); invalidateModels(); toast("Modelo añadido", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const deleteProvider = useMutation({
    mutationFn: async (id: string) => {
      const ok = await confirm({ title: "¿Borrar este proveedor?", message: "Se eliminará junto con su clave cifrada. Los modelos asociados pueden quedar huérfanos.", confirmLabel: "Borrar proveedor" });
      if (!ok) return;
      await api.deleteProvider(id);
      return true;
    },
    onSuccess: (deleted) => { if (deleted) { invalidateProviders(); toast("Proveedor borrado", "ok"); } },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const deleteModel = useMutation({
    mutationFn: async (id: string) => {
      const ok = await confirm({ title: "¿Borrar este modelo?", message: "Los nodos de flujo que lo usen quedarán sin modelo asignado.", confirmLabel: "Borrar modelo" });
      if (!ok) return;
      await api.deleteModel(id);
      return true;
    },
    onSuccess: (deleted) => { if (deleted) { invalidateModels(); toast("Modelo borrado", "ok"); } },
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <>
      <div className="topbar"><h1>Proveedores y modelos</h1></div>

      <div className="grid two">
        <div className="panel">
          <h2>Proveedores</h2>
          <form onSubmit={(e) => { e.preventDefault(); addProvider.mutate(); }}>
            <div className="field">
              <label htmlFor="prov-name">Nombre</label>
              <input id="prov-name" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="anthropic" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="prov-key">API key</label>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  id="prov-key" type={showKey ? "text" : "password"} value={pKey} onChange={(e) => setPKey(e.target.value)}
                  placeholder="sk-…" autoComplete="off" spellCheck={false}
                />
                <button type="button" className="ghost small" onClick={() => setShowKey((v) => !v)} aria-pressed={showKey} title={showKey ? "Ocultar clave" : "Mostrar clave"}>
                  {showKey ? "Ocultar" : "Ver"}
                </button>
              </div>
              <div className="hint">Se cifra en reposo (AES-256-GCM) y nunca se vuelve a mostrar completa.</div>
            </div>
            <button type="submit" disabled={addProvider.isPending || !pName.trim() || !pKey.trim()}>
              {addProvider.isPending ? <Spinner /> : "Añadir proveedor"}
            </button>
          </form>

          <div style={{ marginTop: "1rem" }}>
            {providers.isLoading ? (
              <SkeletonRows rows={2} />
            ) : providers.data?.length ? (
              <table>
                <tbody>
                  {providers.data.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td className="muted">{p.baseUrl ?? "por defecto"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="danger small" onClick={() => deleteProvider.mutate(p.id)} disabled={deleteProvider.isPending}>Borrar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon="⚿" title="Sin proveedores" hint="Añade un proveedor (OpenAI, Anthropic…) con su API key para poder registrar modelos." />
            )}
          </div>
        </div>

        <div className="panel">
          <h2>Modelos</h2>
          <form onSubmit={(e) => { e.preventDefault(); addModel.mutate(); }}>
            <div className="field">
              <label htmlFor="model-prov">Proveedor</label>
              <select id="model-prov" value={m.providerId} onChange={(e) => setM({ ...m, providerId: e.target.value })}>
                <option value="">—</option>
                {providers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="model-id">ID del modelo</label>
              <input id="model-id" value={m.modelId} onChange={(e) => setM({ ...m, modelId: e.target.value })} placeholder="anthropic/claude-sonnet-4-6" spellCheck={false} />
            </div>
            <div className="field">
              <label htmlFor="model-name">Nombre visible</label>
              <input id="model-name" value={m.displayName} onChange={(e) => setM({ ...m, displayName: e.target.value })} placeholder="Claude Sonnet 4.6" />
            </div>
            <div className="field">
              <label>Capacidades</label>
              <div className="row">
                {CAPABILITIES.map((c) => (
                  <label key={c} className="row" style={{ gap: "0.3rem", color: "var(--text)", fontSize: "0.85rem", fontWeight: 400 }}>
                    <input
                      type="checkbox" checked={m.caps.includes(c)}
                      onChange={(e) => setM({ ...m, caps: e.target.checked ? [...m.caps, c] : m.caps.filter((x) => x !== c) })}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" disabled={addModel.isPending || !m.providerId || !m.modelId.trim() || !m.displayName.trim()}>
              {addModel.isPending ? <Spinner /> : "Añadir modelo"}
            </button>
          </form>

          <div style={{ marginTop: "1rem" }}>
            {models.isLoading ? (
              <SkeletonRows rows={2} />
            ) : models.data?.length ? (
              <table>
                <tbody>
                  {models.data.map((model) => (
                    <tr key={model.id}>
                      <td><strong>{model.displayName}</strong><div className="muted">{model.modelId}</div></td>
                      <td>{model.capabilities.map((c) => <span key={c} className="badge accent" style={{ marginRight: 4 }}>{c}</span>)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="danger small" onClick={() => deleteModel.mutate(model.id)} disabled={deleteModel.isPending}>Borrar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon="▣" title="Sin modelos" hint="Registra los modelos que usarán los nodos de flujo y el asistente." />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
