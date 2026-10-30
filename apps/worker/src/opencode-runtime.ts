import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { db, models, providers } from "@factoria/db";
import { decryptSecret } from "@factoria/core";

/**
 * Runtime de opencode para el worker:
 *  1. Genera `auth.json` (claves de proveedores descifradas) y `opencode.json`
 *     (proveedores con baseURL y modelos) a partir de la base de datos.
 *  2. Arranca `opencode serve` si no hay OPENCODE_URL y deja la URL en el entorno.
 */

function opencodeHome(): string {
  return process.env.OPENCODE_HOME ?? path.join(homedir(), ".local/share/opencode");
}

interface ProviderRow {
  id: string;
  name: string;
  baseUrl: string | null;
  apiKeyEncrypted: string;
}

function providerIdFor(p: ProviderRow): string {
  return p.name.toLowerCase().replace(/[^a-z0-9_-]/g, "") || `prov-${p.id.slice(0, 8)}`;
}

/** Genera auth.json y opencode.json con todos los proveedores del sistema. */
export async function generateOpencodeConfig(): Promise<{ authPath: string; configPath: string }> {
  const home = opencodeHome();
  mkdirSync(home, { recursive: true });

  const provs = (await db.select().from(providers)) as ProviderRow[];
  const allModels = await db.select().from(models);

  const auth: Record<string, { type: string; key: string }> = {};
  const configProviders: Record<string, unknown> = {};

  for (const p of provs) {
    const id = providerIdFor(p);
    let key = "";
    try {
      key = decryptSecret(p.apiKeyEncrypted);
    } catch {
      continue;
    }
    auth[id] = { type: "api", key };

    const provModels = allModels.filter((m) => m.providerId === p.id);
    const modelEntries: Record<string, unknown> = {};
    for (const m of provModels) {
      const raw = m.modelId.includes("/") ? m.modelId.slice(m.modelId.indexOf("/") + 1) : m.modelId;
      modelEntries[raw] = {
        name: m.displayName,
        ...(m.contextWindow ? { limit: { context: m.contextWindow, output: Math.min(m.contextWindow, 32768) } } : {}),
      };
    }
    configProviders[id] = {
      name: p.name,
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: (p.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, ""), apiKey: key },
      ...(Object.keys(modelEntries).length ? { models: modelEntries } : {}),
    };
  }

  const authPath = path.join(home, "auth.json");
  writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 });

  const mcpCommand = (process.env.OPENCODE_MCP_COMMAND ?? "/app/apps/worker/node_modules/.bin/tsx /app/apps/mcp/src/index.ts")
    .split(" ")
    .filter(Boolean);
  const config = {
    $schema: "https://opencode.ai/config.json",
    ...(Object.keys(configProviders).length ? { provider: configProviders } : {}),
    ...(existsSync(mcpCommand[0] ?? "") || mcpCommand[0]?.startsWith("/")
      ? { mcp: { "project-info": { type: "local", command: mcpCommand, enabled: true } } }
      : {}),
  };
  const configPath = path.join(home, "opencode.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

  return { authPath, configPath };
}

function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const r = await fetch(`${url.replace(/\/$/, "")}/global/health`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) return resolve(true);
      } catch { /* aún no listo */ }
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 500);
    };
    void tick();
  });
}

let serveChild: ReturnType<typeof spawn> | null = null;

/** Arranca `opencode serve` si procede y devuelve la URL usable. */
let bootPromise: Promise<string | undefined> | null = null;

export async function ensureOpencodeServer(): Promise<string | undefined> {
  if (process.env.OPENCODE_URL) return process.env.OPENCODE_URL;
  if (!bootPromise) {
    bootPromise = Promise.race([
      bootOpencodeServer(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), Number(process.env.OPENCODE_START_TIMEOUT ?? 120000) + 5000)),
    ]).catch((e) => {
      bootPromise = null;
      console.error(`[opencode] arranque falló: ${e instanceof Error ? e.message : e}`);
      return undefined;
    });
  }
  return bootPromise;
}

async function bootOpencodeServer(): Promise<string | undefined> {
  if (process.env.OPENCODE_URL) return process.env.OPENCODE_URL;
  if (process.env.OPENCODE_AUTO === "0") return undefined;

  let bin = process.env.OPENCODE_BIN ?? "opencode";
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore" });
  } catch {
    bin = path.join(process.env.OPENCODE_HOME ?? opencodeHome(), "bin/opencode");
    if (!existsSync(bin)) return undefined;
  }

  const port = Number(process.env.OPENCODE_PORT ?? 4096);
  const url = `http://127.0.0.1:${port}`;
  const { authPath, configPath } = await generateOpencodeConfig();

  serveChild = spawn(bin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    env: {
      ...process.env,
      OPENCODE_CONFIG: configPath,
      XDG_DATA_HOME: path.dirname(opencodeHome()),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  serveChild.stderr?.on("data", (c: Buffer) => console.error(`[opencode] ${c.toString().slice(0, 200)}`));
  serveChild.on("exit", (code) => console.error(`[opencode] el servidor terminó (código ${code})`));
  console.log(`[opencode] arrancando servidor en ${url}…`);

  const ok = await waitForHealth(url, Number(process.env.OPENCODE_START_TIMEOUT ?? 120000));
  if (!ok) {
    console.error("[opencode] el servidor no respondió a tiempo");
    return undefined;
  }
  process.env.OPENCODE_URL = url;
  console.log(`[opencode] servidor listo en ${url} (auth: ${authPath})`);
  return url;
}

export function stopOpencodeServer(): void {
  serveChild?.kill("SIGTERM");
  serveChild = null;
}

/** Regenera auth.json/config (p. ej. tras alta o cambio de credenciales). */
export async function refreshOpencodeConfig(): Promise<void> {
  await generateOpencodeConfig();
}

