import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";

export function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@factoria.dev");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const auth = useMutation({
    mutationFn: () => (mode === "login" ? api.login(email, password) : api.register(email, password, name)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate("/projects");
    },
    onError: (e: Error) => setError(e.message),
  });

  const switchMode = (m: "login" | "register") => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="center">
      <div className="panel auth pad-lg">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">F</span>
          <h1>Factoría de Agentes</h1>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>Orquestación de agentes de IA para desarrollar software.</p>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>
            Entrar
          </button>
          <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>
            Registrarse
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); auth.mutate(); }}>
          {mode === "register" && (
            <div className="field">
              <label htmlFor="login-name">Nombre</label>
              <input id="login-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.dev" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="login-password">Contraseña</label>
            <input
              id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={6}
            />
          </div>
          <button type="submit" disabled={auth.isPending} style={{ width: "100%" }}>
            {auth.isPending ? <Spinner /> : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>
          {error && <div className="error-box" style={{ marginTop: "0.6rem" }} role="alert">{error}</div>}
        </form>
      </div>
    </div>
  );
}
