import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, Modal, SkeletonRows, Spinner, useConfirm, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";

const CATEGORY_TONE: Record<string, string> = { read: "accent", write: "warn", knowledge: "ok", orchestrator: "" };

export function Subagents() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const subagents = useQuery({ queryKey: ["subagents"], queryFn: api.subagents });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [category, setCategory] = useState("read");
  const [preview, setPreview] = useState<{ filename: string; content: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["subagents"] });

  const seed = useMutation({
    mutationFn: api.seedSubagents,
    onSuccess: (r) => { invalidate(); toast(`${r.created} subagentes creados`, "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const create = useMutation({
    mutationFn: () => api.createSubagent({ name, description, instructions, category }),
    onSuccess: () => { setName(""); setDescription(""); setInstructions(""); invalidate(); toast("Subagente creado", "ok"); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const ok = await confirm({ title: "¿Borrar este subagente?", message: "Los nodos de flujo que lo referencien quedarán sin subagente.", confirmLabel: "Borrar subagente" });
      if (!ok) return;
      await api.deleteSubagent(id);
      return true;
    },
    onSuccess: (deleted) => { if (deleted) { invalidate(); toast("Subagente borrado", "ok"); } },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const showFile = useMutation({
    mutationFn: (id: string) => api.materializeSubagent(id, "opencode"),
    onSuccess: setPreview,
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <>
      <div className="topbar">
        <h1>Subagentes</h1>
        <button onClick={() => seed.mutate()} disabled={seed.isPending}>
          {seed.isPending ? <Spinner /> : "Cargar plantillas (12)"}
        </button>
      </div>

      <div className="grid two">
        <div className="panel">
          <h2>Catálogo</h2>
          {subagents.isLoading ? (
            <SkeletonRows rows={4} />
          ) : subagents.data?.length ? (
            <table>
              <tbody>
                {subagents.data.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong> <span className={`badge ${CATEGORY_TONE[s.category] ?? ""}`}>{s.category}</span>
                      <div className="muted">{s.description}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="ghost small" onClick={() => showFile.mutate(s.id)} disabled={showFile.isPending}>Ver fichero</button>{" "}
                      <button className="danger small" onClick={() => remove.mutate(s.id)} disabled={remove.isPending}>Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              icon="◈"
              title="Sin subagentes"
              hint="Carga las 12 plantillas listas (arquitecto, backend, frontend, QA…) o crea el tuyo con sus instrucciones."
              action={<button onClick={() => seed.mutate()}>Cargar plantillas</button>}
            />
          )}
        </div>

        <div className="panel">
          <h2>Nuevo subagente</h2>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <div className="field">
              <label htmlFor="sub-name">Nombre</label>
              <input id="sub-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="revisor_seguridad" />
            </div>
            <div className="field">
              <label htmlFor="sub-desc">Descripción (cuándo usarlo)</label>
              <input id="sub-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Revisa el código en busca de vulnerabilidades" />
            </div>
            <div className="field">
              <label htmlFor="sub-cat">Categoría</label>
              <select id="sub-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {["read", "write", "knowledge", "orchestrator"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sub-ins">Instrucciones (system prompt)</label>
              <textarea id="sub-ins" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Eres un revisor experto en…" />
            </div>
            <button type="submit" disabled={create.isPending || !name || !description || !instructions}>
              {create.isPending ? <Spinner /> : "Crear subagente"}
            </button>
          </form>
        </div>
      </div>

      {preview && (
        <Modal title={preview.filename} onClose={() => setPreview(null)}>
          <pre className="log code-preview">{preview.content}</pre>
        </Modal>
      )}
    </>
  );
}
