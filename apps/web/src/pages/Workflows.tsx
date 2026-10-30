import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useRef } from "react";
import { EmptyState, SkeletonRows, Spinner, useConfirm, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";

export function Workflows() {
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.workflowTemplates });
  const importInput = useRef<HTMLInputElement>(null);
  const importWf = useMutation({
    mutationFn: (data: unknown) => api.workflowImport(data),
    onSuccess: (w) => { qc.invalidateQueries({ queryKey: ["workflows"] }); navigate(`/workflows/${w.id}`); },
  });
  const useTemplate = (t: { name: string; description: string; nodes: unknown[]; edges: unknown[] }) =>
    api.createWorkflow({ name: t.name, description: t.description, nodes: t.nodes as never, edges: t.edges as never }).then((w) => navigate(`/workflows/${w.id}`));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const workflows = useQuery({ queryKey: ["workflows"], queryFn: api.workflows });

  const fromTemplate = useMutation({
    mutationFn: api.workflowFromTemplate,
    onSuccess: (wf) => { qc.invalidateQueries({ queryKey: ["workflows"] }); toast("Flujo creado desde plantilla", "ok"); navigate(`/workflows/${wf.id}`); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const create = useMutation({
    mutationFn: () => api.createWorkflow({ name: "Nuevo flujo", nodes: [{ key: "start", type: "start", name: "Inicio" }, { key: "end", type: "end", name: "Fin" }], edges: [{ fromNodeKey: "start", toNodeKey: "end" }] }),
    onSuccess: (wf) => { qc.invalidateQueries({ queryKey: ["workflows"] }); toast("Flujo creado", "ok"); navigate(`/workflows/${wf.id}`); },
    onError: (e: Error) => toast(e.message, "err"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const ok = await confirm({ title: "¿Borrar este flujo?", message: "Los proyectos que lo usen dejarán de tener flujo asignado.", confirmLabel: "Borrar flujo" });
      if (!ok) return;
      await api.deleteWorkflow(id);
      return true;
    },
    onSuccess: (deleted) => { if (deleted) { qc.invalidateQueries({ queryKey: ["workflows"] }); toast("Flujo borrado", "ok"); } },
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <>
      <div className="topbar">
        <h1>Flujos de trabajo</h1>
        <div className="row">
          <button className="ghost" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Spinner /> : "Nuevo flujo"}
          </button>
          <button onClick={() => fromTemplate.mutate()} disabled={fromTemplate.isPending}>
            {fromTemplate.isPending ? <Spinner /> : "Crear desde plantilla"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Plantillas</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "0.75rem" }}>
          {(templates.data ?? []).map((t) => (
            <div key={t.name} className="panel" style={{ margin: 0 }}>
              <strong>{t.name}</strong>
              <div className="muted" style={{ margin: "0.3rem 0" }}>{t.description}</div>
              <span className="badge">{t.category}</span>
              <button className="small" style={{ marginTop: "0.5rem", width: "100%" }} onClick={() => useTemplate(t)}>Usar plantilla</button>
            </div>
          ))}
        </div>
      </div>

      {workflows.isLoading ? (
        <div className="panel"><SkeletonRows rows={3} /></div>
      ) : workflows.data?.length ? (
        <div className="panel">
          <table>
            <thead><tr><th>Nombre</th><th>Versión</th><th></th></tr></thead>
            <tbody>
              {workflows.data.map((w) => (
                <tr key={w.id}>
                  <td><Link to={`/workflows/${w.id}`}>{w.name}</Link></td>
                  <td><span className="badge">v{w.version}</span></td>
                  <td style={{ textAlign: "right" }}>
                    <button className="ghost small" onClick={() => navigate(`/workflows/${w.id}`)}>Editar</button>{" "}
                    <button className="danger small" onClick={() => remove.mutate(w.id)} disabled={remove.isPending}>Borrar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon="⎇"
            title="Sin flujos de trabajo"
            hint="Un flujo define el grafo de tareas que ejecutarán los agentes. Empieza desde la plantilla para ver un ejemplo completo."
            action={<button onClick={() => fromTemplate.mutate()}>Crear desde plantilla</button>}
          />
        </div>
      )}
    </>
  );
}
