import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RepoProvider } from "@factoria/shared";

export interface GitResult {
  ok: boolean;
  output: string;
}

function git(cwd: string, args: string[], extraEnv?: NodeJS.ProcessEnv): GitResult {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(extraEnv ?? {}) },
    });
    return { ok: true, output };
  } catch (error) {
    const e = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}` || e.message || "error";
    return { ok: false, output: String(output) };
  }
}

export function isGitRepo(dir: string): boolean {
  return git(dir, ["rev-parse", "--is-inside-work-tree"]).ok;
}

export function initRepo(dir: string): GitResult {
  const r = git(dir, ["init"]);
  git(dir, ["config", "user.email", "bot@factoria.dev"]);
  git(dir, ["config", "user.name", "Factoría"]);
  return r;
}

/** Crea un worktree en `worktreePath` con una rama nueva a partir de HEAD. */
export function createWorktree(repoDir: string, worktreePath: string, branch: string): GitResult {
  return git(repoDir, ["worktree", "add", "-b", branch, worktreePath]);
}

/** Fusiona una rama en la rama actual del repo principal. */
export function mergeWorktree(repoDir: string, branch: string, message: string): GitResult {
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-m", `snapshot antes de integrar ${branch}`]);
  return git(repoDir, ["merge", "--no-ff", "-m", message, branch]);
}

export function removeWorktree(repoDir: string, worktreePath: string): GitResult {
  return git(repoDir, ["worktree", "remove", "--force", worktreePath]);
}

export function commitAll(dir: string, message: string): GitResult {
  git(dir, ["add", "-A"]);
  return git(dir, ["commit", "-m", message]);
}

export function push(dir: string, remote = "origin", branch = "HEAD"): GitResult {
  return git(dir, ["push", remote, branch]);
}

export function currentBranch(dir: string): string {
  const r = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.ok ? r.output.trim() : "main";
}

// --- Credenciales Git (token HTTPS, nunca persistido en el remoto) ---

export interface GitAuth {
  provider: RepoProvider;
  token: string;
  username?: string;
}

/** Usuario por defecto según proveedor para autenticación HTTPS con token. */
export function authUsername(provider: RepoProvider): string {
  if (provider === "github") return "x-access-token";
  if (provider === "gitlab") return "oauth2";
  return "git";
}

/**
 * Cabecera de autorización efímera (Basic). Se pasa a git con `-c http.extraHeader`,
 * de modo que el token no queda en la URL del remoto ni en disco.
 */
export function authExtraHeader(auth: GitAuth): string {
  const user = auth.username ?? authUsername(auth.provider);
  const basic = Buffer.from(`${user}:${auth.token}`).toString("base64");
  return `http.extraHeader=Authorization: Basic ${basic}`;
}

export function cloneWithAuth(
  dir: string,
  url: string,
  auth?: GitAuth,
  branch?: string | null,
): GitResult {
  const args = auth ? ["-c", authExtraHeader(auth), "clone", url, "."] : ["clone", url, "."];
  if (branch) args.push("--branch", branch);
  return git(dir, args);
}

export function fetchWithAuth(dir: string, auth?: GitAuth): GitResult {
  const args = auth ? ["-c", authExtraHeader(auth), "fetch", "--all"] : ["fetch", "--all"];
  return git(dir, args);
}

/** Comprueba acceso a un remoto (ramas + HEAD) sin clonar. */
export function lsRemote(url: string, auth?: GitAuth): GitResult {
  const args = auth
    ? ["-c", authExtraHeader(auth), "ls-remote", "--heads", url]
    : ["ls-remote", "--heads", url];
  return git(process.cwd(), args);
}

export function pushWithAuth(dir: string, branch = "HEAD", auth?: GitAuth, remote = "origin"): GitResult {
  const args = auth
    ? ["-c", authExtraHeader(auth), "push", remote, branch]
    : ["push", remote, branch];
  return git(dir, args);
}

// --- Diffs y hooks ---

/** Diff staged (index vs HEAD). Vacío si no hay cambios staged. */
export function diffStaged(dir: string): string {
  const r = git(dir, ["diff", "--cached"]);
  return r.ok ? r.output : "";
}

/** Diff del árbol de trabajo (working tree vs index). */
export function diffWorking(dir: string): string {
  const r = git(dir, ["diff"]);
  return r.ok ? r.output : "";
}

/** Marca todos los cambios (incluidos ficheros nuevos) en el índice. */
export function stageAll(dir: string): GitResult {
  return git(dir, ["add", "-A"]);
}

/** Diff completo respecto a HEAD (staged + working). */
export function diffHead(dir: string): string {
  const r = git(dir, ["diff", "HEAD"]);
  return r.ok ? r.output : "";
}

export function revParse(dir: string, ref = "HEAD"): string {
  const r = git(dir, ["rev-parse", ref]);
  return r.ok ? r.output.trim() : "";
}

/** Configura core.hooksPath para que git use los hooks gestionados. */
export function setHooksPath(dir: string, hooksPath: string): GitResult {
  return git(dir, ["config", "core.hooksPath", hooksPath]);
}

/**
 * Materializa ficheros de hooks/utilidades en el workspace, los marca
 * ejecutables y activa `core.hooksPath`.
 */
export function installGitHooks(
  workspace: string,
  files: Record<string, string>,
  hooksPath = ".factoria/hooks",
): GitResult {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(workspace, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, { mode: 0o755 });
    try {
      chmodSync(abs, 0o755);
    } catch {
      /* permisos no aplicables en algunos FS */
    }
  }
  if (!existsSync(path.join(workspace, ".git"))) return { ok: false, output: "no es un repo git" };
  return setHooksPath(workspace, hooksPath);
}
