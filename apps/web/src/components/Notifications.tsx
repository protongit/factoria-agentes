import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type NotificationAlert, type RunAlertKind } from "../lib/api.ts";
import { useToast } from "./ui.tsx";

const SEEN_KEY = "factoria-notifications-seen-v1";
const NOTIFIED_KEY = "factoria-notifications-notified-v1";
const MAX_SEEN = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

const TITLES: Record<RunAlertKind, string> = {
  approval: "Validación pendiente",
  failed: "La ejecución ha fallado",
  succeeded: "La ejecución ha terminado",
  cancelled: "La ejecución se ha cancelado",
};

const ICONS: Record<RunAlertKind, string> = {
  approval: "⏸",
  failed: "✕",
  succeeded: "✓",
  cancelled: "■",
};

function loadSeen(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveSeen(ids: string[]): void {
  localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-MAX_SEEN)));
}

function loadNotified(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function permissionState(): NotificationPermission {
  return typeof Notification === "undefined" ? "denied" : Notification.permission;
}

export function Notifications() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string[]>(loadSeen);
  const seenRef = useRef(seen);
  const notifiedRef = useRef<string[]>(loadNotified());
  const [permission, setPermission] = useState<NotificationPermission>(permissionState);
  const baselined = useRef(false);

  const alertsQ = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications,
    refetchInterval: 6000,
    refetchOnWindowFocus: true,
  });
  const alerts = alertsQ.data?.alerts ?? [];
  const unseen = alerts.filter((a) => !seen.includes(a.id));

  const markSeen = (ids: string[]) => {
    setSeen((prev) => {
      const next = [...prev, ...ids.filter((id) => !prev.includes(id))].slice(-MAX_SEEN);
      seenRef.current = next;
      saveSeen(next);
      return next;
    });
  };

  const markNotified = (ids: string[]) => {
    const next = [...notifiedRef.current, ...ids.filter((id) => !notifiedRef.current.includes(id))].slice(-MAX_SEEN);
    notifiedRef.current = next;
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(next));
  };

  const push = (alert: NotificationAlert) => {
    const title = `${TITLES[alert.kind]} · ${alert.projectName}`;
    toast(`${title}: ${alert.message}`, alert.kind === "failed" ? "err" : alert.kind === "succeeded" ? "ok" : "info");
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(title, {
        body: `${alert.message}${alert.nextSteps[0] ? `\n→ ${alert.nextSteps[0]}` : ""}`,
        tag: alert.id,
        requireInteraction: alert.kind === "approval",
      });
      n.onclick = () => {
        window.focus();
        navigate(alert.href);
        n.close();
      };
    }
  };

  // Avisa de los cambios que lleguen mientras la app está abierta. Los avisos
  // de las últimas 24 h quedan como no leídos (badge) hasta que se abren o se
  // marcan como leídos; el aviso emergente solo se muestra una vez por aviso.
  useEffect(() => {
    if (alerts.length === 0) return;
    const unseen = alerts.filter((a) => !seenRef.current.includes(a.id));
    if (unseen.length === 0) return;
    const fresh = unseen.filter((a) => !notifiedRef.current.includes(a.id));
    if (fresh.length === 0) return;

    if (!baselined.current) {
      baselined.current = true;
      const old = fresh.filter((a) => Date.now() - new Date(a.createdAt).getTime() >= DAY_MS);
      if (old.length > 0) markSeen(old.map((a) => a.id));
      const recent = fresh.find((a) => Date.now() - new Date(a.createdAt).getTime() < DAY_MS);
      if (recent) push(recent);
      markNotified(fresh.map((a) => a.id));
      return;
    }

    fresh.slice(0, 3).forEach(push);
    markNotified(fresh.map((a) => a.id));
    qc.invalidateQueries({ queryKey: ["assistant"] });
    qc.invalidateQueries({ queryKey: ["runs"] });
    qc.invalidateQueries({ queryKey: ["run"] });
  }, [alertsQ.dataUpdatedAt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") {
      toast("Este navegador no soporta notificaciones", "err");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") toast("Notificaciones del navegador activadas", "ok");
    else if (result === "denied") toast("El navegador ha bloqueado las notificaciones", "err");
  };

  return (
    <div className="notif">
      <button
        className={`notif-bell${unseen.length > 0 ? " has-unread" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Notificaciones${unseen.length > 0 ? ` (${unseen.length} sin leer)` : ""}`}
      >
        <span aria-hidden="true">🔔</span>
        <span className="notif-label">Notificaciones</span>
        {unseen.length > 0 && <span className="notif-badge">{unseen.length}</span>}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="notif-panel" role="dialog" aria-label="Notificaciones">
            <div className="row spread">
              <strong>Notificaciones</strong>
              <button className="ghost small" onClick={() => setOpen(false)} aria-label="Cerrar">×</button>
            </div>

            {permission !== "granted" && (
              <button className="ghost small" style={{ marginTop: "0.4rem" }} onClick={enableNotifications}>
                Activar notificaciones del navegador
              </button>
            )}
            {permission === "denied" && (
              <p className="muted" style={{ fontSize: "0.8rem", margin: "0.3rem 0 0" }}>
                El navegador las tiene bloqueadas; puedes habilitarlas en los ajustes del sitio.
              </p>
            )}

            <div className="notif-list">
              {alerts.length === 0 && <p className="muted">Sin avisos recientes.</p>}
              {alerts.map((a) => (
                <button
                  key={a.id}
                  className={`notif-item ${a.kind}`}
                  onClick={() => { markSeen([a.id]); navigate(a.href); setOpen(false); }}
                >
                  <span className="notif-kind" aria-hidden="true">{ICONS[a.kind]}</span>
                  <span style={{ minWidth: 0 }}>
                    <span>
                      <strong>{a.projectName}</strong>
                      <span className="muted"> · {new Date(a.createdAt).toLocaleString()}</span>
                    </span>
                    <span className="notif-message">{a.message}</span>
                    {a.nextSteps[0] && <span className="notif-next">→ {a.nextSteps[0]}</span>}
                  </span>
                </button>
              ))}
            </div>

            <div className="row spread">
              <button className="ghost small" onClick={() => markSeen(alerts.map((a) => a.id))} disabled={unseen.length === 0}>
                Marcar leídas
              </button>
              <button className="ghost small" onClick={() => alertsQ.refetch()}>Actualizar</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
