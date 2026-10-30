import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { ConfirmProvider, ToastProvider, useToast } from "./components/ui.tsx";
import { api } from "./lib/api.ts";
import { I18nProvider, useI18n } from "./lib/i18n.tsx";
import { Login } from "./pages/Login.tsx";
import { ProjectDetail } from "./pages/ProjectDetail.tsx";
import { Projects } from "./pages/Projects.tsx";
import { Providers } from "./pages/Providers.tsx";
import { Subagents } from "./pages/Subagents.tsx";
import { WorkflowEditor } from "./pages/WorkflowEditor.tsx";
import { Workflows } from "./pages/Workflows.tsx";

const NAV = [
  { to: "/projects", key: "nav.projects", icon: "▦" },
  { to: "/workflows", key: "nav.workflows", icon: "⎇" },
  { to: "/subagents", key: "nav.subagents", icon: "◈" },
  { to: "/providers", key: "nav.providers", icon: "⚿" },
];

function Layout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t, lang, setLang } = useI18n();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar") === "collapsed");

  const toggleSidebar = () =>
    setCollapsed((c) => {
      localStorage.setItem("sidebar", c ? "" : "collapsed");
      return !c;
    });

  if (me.isLoading)
    return (
      <div className="center">
        <span className="spinner" aria-label="Cargando" />
      </div>
    );
  if (me.isError || !me.data) return <Navigate to="/login" replace />;

  const initial = (me.data.name || me.data.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className={`layout${collapsed ? " collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1>{t("app.name")}</h1>
          <button className="sidebar-toggle" onClick={toggleSidebar} title={t("action.hideMenu")} aria-label={t("action.hideMenu")}>«</button>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to}>
              <span aria-hidden="true">{item.icon}</span> {t(item.key)}
            </NavLink>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div className="sidebar-foot">
          <button className="ghost small" onClick={() => setLang(lang === "es" ? "en" : "es")} title="Idioma / Language">
            {lang === "es" ? "ES" : "EN"} · {lang === "es" ? "English" : "Español"}
          </button>
          <div className="sidebar-user" title={me.data.email}>
            <span className="sidebar-avatar" aria-hidden="true">{initial}</span>
            <span style={{ minWidth: 0 }}>
              <span className="sidebar-user-name">{me.data.name}</span>
              <br />
              <span className="sidebar-user-mail">{me.data.email}</span>
            </span>
          </div>
          <button
            className="ghost small"
            onClick={async () => {
              try {
                await api.logout();
              } catch { /* la sesión puede haber caducado ya */ }
              queryClient.clear();
              toast("Sesión cerrada", "info");
              navigate("/login");
            }}
          >
            {t("action.logout")}
          </button>
        </div>
      </aside>
      <main className="content">
        {collapsed && (
          <button className="sidebar-open" onClick={toggleSidebar} title={t("action.showMenu")} aria-label={t("action.showMenu")}>»</button>
        )}
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/projects" replace />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route path="/workflows/:id" element={<WorkflowEditor />} />
              <Route path="/subagents" element={<Subagents />} />
              <Route path="/providers" element={<Providers />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
