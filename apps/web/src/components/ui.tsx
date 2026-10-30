import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/* --- Toasts --- */

type ToastKind = "ok" | "err" | "info";
interface Toast { id: number; kind: ToastKind; message: string }

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const icons: Record<ToastKind, string> = { ok: "✓", err: "✕", info: "ℹ" };

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-icon">{icons[t.kind]}</span>
            <span>{t.message}</span>
            <button className="toast-close" aria-label="Cerrar" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* --- Confirmación --- */

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>>(
  async () => false,
);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback(
    (opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) =>
        setState({
          title: opts.title,
          message: opts.message ?? "Esta acción no se puede deshacer.",
          confirmLabel: opts.confirmLabel ?? "Confirmar",
          danger: opts.danger ?? true,
          resolve,
        }),
      ),
    [],
  );

  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-overlay" onClick={() => close(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-label={state.title} onClick={(e) => e.stopPropagation()}>
            <h2>{state.title}</h2>
            <p className="muted" style={{ margin: 0 }}>{state.message}</p>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="ghost" onClick={() => close(false)}>Cancelar</button>
              <button className={state.danger ? "danger" : ""} onClick={() => close(true)}>{state.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/* --- Modal genérico --- */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost small" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* --- Spinner --- */

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: "0.5rem" }}>
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

/* --- Estado vacío --- */

export function EmptyState({ icon = "◇", title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <span className="empty-title">{title}</span>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

/* --- Skeleton de tabla/lista --- */

export function SkeletonRows({ rows = 4, height = "1.6rem" }: { rows?: number; height?: string }) {
  return (
    <div style={{ display: "grid", gap: "0.6rem" }} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

/* --- Badge de estado --- */

const STATUS_TONE: Record<string, string> = {
  completed: "ok", succeeded: "ok", satisfied: "ok", indexed: "ok", published: "ok",
  running: "warn", pending: "warn", unsatisfied: "warn", pending_index: "warn", awaiting: "warn",
  failed: "err", error: "err",
  active: "accent",
};

export function StatusBadge({ status, pulse }: { status: string; pulse?: boolean }) {
  const tone = STATUS_TONE[status] ?? "";
  return (
    <span className={`badge ${tone}${pulse ? " pulse" : ""}`}>
      <span className="dot" aria-hidden="true" />
      {status}
    </span>
  );
}
