import { buildCreateConfig, containerName, type ContainerSpec } from "./containers.ts";

/** Cliente mínimo de la API de Docker a través del Docker Socket Proxy. */
export function dockerProxyUrl(): string {
  return process.env.DOCKER_PROXY_URL ?? "http://docker-socket-proxy:2375";
}

export interface DockerResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function dockerApi(pathname: string, init?: RequestInit): Promise<DockerResponse> {
  try {
    const resp = await fetch(`${dockerProxyUrl().replace(/\/$/, "")}${pathname}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(30000),
    });
    const text = await resp.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      /* texto plano (logs) */
    }
    return { ok: resp.ok, status: resp.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

export async function dockerAvailable(): Promise<boolean> {
  return (await dockerApi("/_ping")).ok;
}

export interface DockerPortBinding {
  HostIp?: string;
  HostPort?: string;
}

export interface DockerInspect {
  Id?: string;
  State?: { Running?: boolean; Status?: string; Error?: string };
  Config?: { Image?: string };
  HostConfig?: { PortBindings?: Record<string, DockerPortBinding[]> };
  NetworkSettings?: { Ports?: Record<string, DockerPortBinding[] | null> };
}

export async function inspectContainer(name: string): Promise<DockerInspect | undefined> {
  const r = await dockerApi(`/containers/${encodeURIComponent(name)}/json`);
  return r.ok ? (r.body as DockerInspect) : undefined;
}

/** Puerto del host asociado a un puerto interno del contenedor (si está publicado). */
export async function containerHostPort(name: string, containerPort: number): Promise<number | null> {
  const info = await inspectContainer(name);
  const binding = info?.NetworkSettings?.Ports?.[`${containerPort}/tcp`]?.[0]?.HostPort;
  return binding ? Number(binding) : null;
}

export interface ExecOptions {
  workingDir?: string;
  detach?: boolean;
  user?: string;
}

/** Ejecuta un comando dentro del contenedor (por defecto en segundo plano). */
export async function execContainer(name: string, cmd: string[], opts: ExecOptions = {}): Promise<DockerResponse> {
  const created = await dockerApi(`/containers/${encodeURIComponent(name)}/exec`, {
    method: "POST",
    body: JSON.stringify({
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: opts.workingDir ?? "/workspace",
      ...(opts.user ? { User: opts.user } : {}),
      Cmd: cmd,
    }),
  });
  if (!created.ok) return created;
  const id = (created.body as { Id?: string }).Id;
  if (!id) return { ok: false, status: 500, body: "El motor no devolvió un id de exec" };
  return dockerApi(`/exec/${encodeURIComponent(id)}/start`, {
    method: "POST",
    body: JSON.stringify({ Detach: opts.detach ?? true, Tty: false }),
  });
}

export interface EnsureResult {
  id: string;
  name: string;
  running: boolean;
  created: boolean;
  error?: string;
}

/** Crea (si hace falta) y arranca el contenedor descrito por `spec`. Idempotente. */
export async function ensureContainer(spec: ContainerSpec): Promise<EnsureResult> {
  const name = containerName(spec.projectId);
  let existing = await inspectContainer(name);

  // Si se necesitan puertos publicados y el contenedor actual no los tiene,
  // hay que recrearlo (los port bindings no se pueden cambiar en caliente).
  const desiredPorts = spec.ports ?? [];
  const boundPorts = existing?.HostConfig?.PortBindings ?? {};
  const missingPorts = desiredPorts.some((port) => !boundPorts[`${port}/tcp`]?.length);
  if (existing && missingPorts) {
    await removeContainer(name);
    existing = undefined;
  }

  if (existing?.State?.Running) return { id: existing.Id ?? name, name, running: true, created: false };

  if (existing) {
    const start = await dockerApi(`/containers/${encodeURIComponent(name)}/start`, { method: "POST" });
    return { id: existing.Id ?? name, name, running: start.ok, created: false, error: start.ok ? undefined : String(start.body).slice(0, 300) };
  }

  const { name: createName, body } = buildCreateConfig(spec);
  const created = await dockerApi(`/containers/create?name=${encodeURIComponent(createName)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!created.ok) {
    const msg = String((created.body as { message?: string })?.message ?? created.body).slice(0, 300);
    return { id: name, name, running: false, created: false, error: msg };
  }
  const id = (created.body as { Id?: string }).Id ?? name;
  const started = await dockerApi(`/containers/${encodeURIComponent(name)}/start`, { method: "POST" });
  return { id, name, running: started.ok, created: true, error: started.ok ? undefined : String(started.body).slice(0, 300) };
}

export async function stopContainer(name: string): Promise<void> {
  await dockerApi(`/containers/${encodeURIComponent(name)}/stop?t=10`, { method: "POST" });
}

export async function removeContainer(name: string): Promise<void> {
  await dockerApi(`/containers/${encodeURIComponent(name)}?force=true`, { method: "DELETE" });
}

export async function containerLogs(name: string, tail = 200): Promise<string> {
  const r = await dockerApi(`/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&tail=${tail}`);
  return typeof r.body === "string" ? r.body : JSON.stringify(r.body).slice(0, 20000);
}
