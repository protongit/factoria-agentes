import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, SkeletonRows, Spinner, StatusBadge, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";

export function Projects() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const workflows = useQuery({ queryKey: ["workflows"], queryFn: api.workflows });
  const [form, setForm] = useState({ name: "", programName: "", objective: "", workflowId: "" });
  const [showForm, setShowForm] = useState(false);

  const create = useMutation({
    mutationFn: () => api.createProject({ ...form, workflowId: form.workflowId || undefined }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["projects"] }); toast("Proyecto creado", "ok"); navigate(`/projects/${p.id}`); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const canSubmit = form.name.trim() && form.programName.trim() && form.objective.trim();

  return (
    <>
      <div className="topbar">
        <h1>Proyectos</h1>
        <button onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
          {showForm ? "Cerrar formulario" : "+ Nuevo proyecto"}
        </button>
      </div>

      {showForm && (
        <div className="panel">
          <h2>Nuevo proyecto</h2>
          <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate(); }}>
            <div className="grid two">
              <div className="field">
                <label htmlFor="proj-name">Nombre</label>
                <input id="proj-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mi aplicación" />
              </div>
              <div className="field">
                <label htmlFor="proj-program">Nombre del programa</label>
                <input id="proj-program" value={form.programName} onChange={(e) => setForm({ ...form, programName: e.target.value })} placeholder="programa_principal" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="proj-obj">Objetivo</label>
              <textarea id="proj-obj" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="¿Qué debe construir el equipo de agentes?" />
            </div>
            <div className="field">
              <label htmlFor="proj-wf">Flujo de trabajo</label>
              <select id="proj-wf" value={form.workflowId} onChange={(e) => setForm({ ...form, workflowId: e.target.value })}>
                <option value="">—</option>
                {workflows.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {workflows.data?.length === 0 && <div className="hint">Aún no hay flujos: créalo después desde «Flujos de trabajo».</div>}
            </div>
            <button type="submit" disabled={create.isPending || !canSubmit}>
              {create.isPending ? <Spinner /> : "Crear proyecto"}
            </button>
            {create.isError && <div className="error-box" style={{ marginTop: "0.6rem" }} role="alert">{(create.error as Error).message}</div>}
          </form>
        </div>
      )}

      {projects.isLoading ? (
        <div className="panel"><SkeletonRows rows={3} height="3rem" /></div>
      ) : projects.isError ? (
        <div className="panel error-box">No se pudieron cargar los proyectos: {(projects.error as Error).message}</div>
      ) : projects.data?.length ? (
        <div className="grid cards">
          {projects.data.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card">
              <div className="row spread">
                <h3>{p.name}</h3>
                <StatusBadge status={p.status} />
              </div>
              <span className="muted">{p.programName}</span>
              {p.objective && <p className="muted" style={{ margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.objective}</p>}
              {(p.stack?.length ?? 0) > 0 && (
                <div className="row" style={{ marginTop: "auto" }}>
                  {p.stack.slice(0, 4).map((s) => <span key={s} className="badge">{s}</span>)}
                </div>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon="▦"
            title="Sin proyectos todavía"
            hint="Crea tu primer proyecto, define su objetivo y asigna un flujo de trabajo para lanzar agentes."
            action={<button onClick={() => setShowForm(true)}>Crear el primero</button>}
          />
        </div>
      )}
    </>
  );
}
