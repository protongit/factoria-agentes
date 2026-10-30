import { createHash } from "node:crypto";
import type { ContainerNetworkMode } from "@factoria/shared";

/** Imagen base por defecto para los contenedores de proyecto. */
export function defaultProjectImage(): string {
  return process.env.PROJECT_CONTAINER_IMAGE ?? "factoria/project-dev:latest";
}

/** Nombre determinista y seguro del contenedor de un proyecto. */
export function containerName(projectId: string): string {
  const short = createHash("sha1").update(projectId).digest("hex").slice(0, 12);
  return `factoria-proj-${short}`;
}

export interface ContainerSpec {
  projectId: string;
  image: string;
  workspacePath: string;
  networkMode: ContainerNetworkMode;
  cpuLimit?: number;
  memoryMb?: number;
  env?: Record<string, string>;
  entrypoint?: string[];
  cmd?: string[];
  /** Puertos del contenedor que se publican en el host (efímeros). */
  ports?: number[];
}

/** Nombre de red Docker según el modo del proyecto. */
export function dockerNetworkMode(mode: ContainerNetworkMode): string {
  if (mode === "closed") return process.env.PROJECT_NETWORK_CLOSED ?? "factoria-projects";
  return process.env.PROJECT_NETWORK_OPEN ?? "factoria-agentes_internal";
}

/**
 * Traduce la ruta del workspace (vista desde api/worker) a la ruta del host que
 * debe usar el daemon de contenedores para el bind-mount. Si `WORKSPACES_HOST_ROOT`
 * no está definido, se asume que el daemon comparte el filesystem del contenedor.
 */
export function hostWorkspacePath(containerPath: string): string {
  const hostRoot = process.env.WORKSPACES_HOST_ROOT;
  const containerRoot = process.env.WORKSPACES_ROOT ?? "/workspaces";
  if (hostRoot && containerPath.startsWith(containerRoot)) {
    return hostRoot.replace(/\/$/, "") + containerPath.slice(containerRoot.length);
  }
  return containerPath;
}

export interface DockerCreateBody {
  Image: string;
  Cmd: string[];
  WorkingDir: string;
  Env: string[];
  Labels: Record<string, string>;
  Tmpfs: Record<string, string>;
  ExposedPorts?: Record<string, Record<string, never>>;
  NetworkingConfig: { EndpointsConfig: Record<string, Record<string, never>> };
  HostConfig: {
    Binds: string[];
    NetworkMode: string;
    Memory: number;
    NanoCpus: number;
    SecurityOpt: string[];
    CapDrop: string[];
    ReadonlyRootfs: boolean;
    PortBindings?: Record<string, { HostIp?: string; HostPort: string }[]>;
  };
}

/** Cuerpo de `POST /containers/create` para la API de Docker. */
export function buildCreateConfig(spec: ContainerSpec): { name: string; body: DockerCreateBody } {
  const network = dockerNetworkMode(spec.networkMode);
  const ports = spec.ports ?? [];
  const exposedPorts = ports.length
    ? Object.fromEntries(ports.map((port) => [`${port}/tcp`, {}]))
    : undefined;
  const portBindings = ports.length
    ? Object.fromEntries(ports.map((port) => [`${port}/tcp`, [{ HostIp: "127.0.0.1", HostPort: "" }]]))
    : undefined;
  return {
    name: containerName(spec.projectId),
    body: {
      Image: spec.image,
      Cmd: spec.cmd ?? ["sleep", "infinity"],
      WorkingDir: "/workspace",
      Env: Object.entries(spec.env ?? {}).map(([k, v]) => `${k}=${v}`),
      Labels: { "factoria.project": spec.projectId, "factoria.managed": "true" },
      Tmpfs: { "/run/factoria-secrets": "rw,noexec,nosuid,size=16m,mode=0700" },
      ...(exposedPorts ? { ExposedPorts: exposedPorts } : {}),
      NetworkingConfig: { EndpointsConfig: { [network]: {} } },
      HostConfig: {
        Binds: [`${hostWorkspacePath(spec.workspacePath)}:/workspace`],
        NetworkMode: network,
        Memory: (spec.memoryMb ?? 2048) * 1024 * 1024,
        NanoCpus: (spec.cpuLimit ?? 2) * 1_000_000_000,
        SecurityOpt: ["no-new-privileges"],
        CapDrop: ["ALL"],
        ReadonlyRootfs: false,
        ...(portBindings ? { PortBindings: portBindings } : {}),
      },
    },
  };
}
