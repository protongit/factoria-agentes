import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "es" | "en";

const DICT: Record<Lang, Record<string, string>> = {
  es: {
    "app.name": "Factoría de Agentes",
    "nav.projects": "Proyectos",
    "nav.workflows": "Flujos de trabajo",
    "nav.subagents": "Subagentes",
    "nav.providers": "Proveedores y modelos",
    "action.logout": "Salir",
    "action.hideMenu": "Ocultar menú",
    "action.showMenu": "Mostrar menú",
    "login.subtitle": "Orquestación de agentes de IA para desarrollar software.",
    "login.enter": "Entrar",
    "login.register": "Registrarse",
    "login.name": "Nombre",
    "login.email": "Email",
    "login.password": "Contraseña",
    "login.createAccount": "Crear cuenta",
  },
  en: {
    "app.name": "Agent Factory",
    "nav.projects": "Projects",
    "nav.workflows": "Workflows",
    "nav.subagents": "Subagents",
    "nav.providers": "Providers & models",
    "action.logout": "Sign out",
    "action.hideMenu": "Hide menu",
    "action.showMenu": "Show menu",
    "login.subtitle": "Orchestrate AI agents to build software.",
    "login.enter": "Sign in",
    "login.register": "Sign up",
    "login.name": "Name",
    "login.email": "Email",
    "login.password": "Password",
    "login.createAccount": "Create account",
  },
};

interface I18n {
  lang: Lang;
  t: (key: string) => string;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18n>({ lang: "es", t: (k) => k, setLang: () => {} });

export function useI18n(): I18n {
  return useContext(I18nContext);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("lang") as Lang) || "es");
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    localStorage.setItem("lang", l);
    setLangState(l);
  }, []);
  const t = useCallback((key: string) => DICT[lang][key] ?? DICT.es[key] ?? key, [lang]);
  return <I18nContext.Provider value={{ lang, t, setLang }}>{children}</I18nContext.Provider>;
}