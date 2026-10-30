import { db, projectContainers, projects } from "@factoria/db";
import {
  containerLogs as dockerLogs,
  containerName,
  defaultProjectImage,
  dockerAvailable,
  ensureContainer,
  inspectContainer,
  removeContainer,
  stopContainer,
  type ContainerSpec,
} from "@factoria/core";
import type { ContainerNetworkMode, ContainerStatus } from "@factoria/shared";
import { eq } from "drizzle-orm";

export interface ContainerInfo {
  id: string;
  name: string;
  status: ContainerStatus;
  image: string;
  endpoint?: string;
  error?: string;
}

function specFor(project: {
  id: string;
  containerImage: string | null;
  containerNetworkMode: string;
  workspaceRoot: string | null;
  devPort?: number | null;
}): ContainerSpec {
  return {
    projectId: project.id,
    image: project.containerImage ?? defaultProjectImage(),
    workspacePath: project.workspaceRoot ?? `${process.env.WORKSPACES_ROOT ?? "/workspaces"}/${project.id}`,
    networkMode: project.containerNetworkMode as ContainerNetworkMode,
    env: { FACTORIA_PROJECT_ID: project.id },
    // Se publica el puerto de la app (efímero en el host) para poder abrirla.
    ports: [project.devPort ?? 3000],
  };
}

async function persist(
  projectId: string,
  status: ContainerStatus,
  fields: { containerId?: string; image?: string; lastError?: string | null } = {},
): Promise<void> {
  const now = new Date();
  await db
    .insert(projectContainers)
    .values({
      projectId,
      name: containerName(projectId),
      status,
      containerId: fields.containerId,
      image: fields.image,
      lastError: fields.lastError ?? undefined,
      ...(status === "running" ? { lastStartedAt: now } : {}),
      ...(status === "stopped" ? { lastStoppedAt: now } : {}),
    })
    .onConflictDoUpdate({
      target: projectContainers.projectId,
      set: {
        status,
        name: containerName(projectId),
        ...(fields.containerId !== undefined ? { containerId: fields.containerId } : {}),
        ...(fields.image !== undefined ? { image: fields.image } : {}),
        ...(fields.lastError !== undefined ? { lastError: fields.lastError } : {}),
        ...(status === "running" ? { lastStartedAt: now } : {}),
        ...(status === "stopped" ? { lastStoppedAt: now } : {}),
      },
    });
}

/** Arranca (o crea) el contenedor del proyecto. Idempotente. */
export async function ensureProjectContainer(projectId: string): Promise<ContainerInfo | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || !project.containerEnabled) return null;

  await persist(projectId, "starting", { image: project.containerImage ?? defaultProjectImage() });
  const result = await ensureContainer(specFor(project));
  if (!result.running) {
    await persist(projectId, "error", { containerId: result.id, lastError: result.error ?? "no arrancó" });
    return { id: result.id, name: result.name, status: "error", image: project.containerImage ?? defaultProjectImage(), error: result.error };
  }
  await persist(projectId, "running", { containerId: result.id });
  return { id: result.id, name: result.name, status: "running", image: project.containerImage ?? defaultProjectImage(), endpoint: `http://${result.name}:4096` };
}

export async function stopProjectContainer(projectId: string): Promise<ContainerInfo> {
  const name = containerName(projectId);
  await stopContainer(name);
  await persist(projectId, "stopped");
  return { id: name, name, status: "stopped", image: "" };
}

export async function rebuildProjectContainer(projectId: string): Promise<ContainerInfo | null> {
  await removeContainer(containerName(projectId));
  return ensureProjectContainer(projectId);
}

export async function containerStatus(projectId: string): Promise<ContainerInfo | null> {
  const [row] = await db.select().from(projectContainers).where(eq(projectContainers.projectId, projectId)).limit(1);
  const name = row?.name ?? containerName(projectId);
  const info = await inspectContainer(name);
  const running = Boolean(info?.State?.Running);
  const status: ContainerStatus = running ? "running" : row?.status === "error" ? "error" : "stopped";
  if (row && row.status !== status) await persist(projectId, status, { containerId: info?.Id });
  return {
    id: info?.Id ?? row?.containerId ?? name,
    name,
    status,
    image: row?.image ?? "",
    endpoint: running ? `http://${name}:4096` : undefined,
    error: row?.lastError ?? undefined,
  };
}

export async function projectContainerLogs(projectId: string, tail = 200): Promise<string> {
  const [row] = await db.select().from(projectContainers).where(eq(projectContainers.projectId, projectId)).limit(1);
  return dockerLogs(row?.name ?? containerName(projectId), tail);
}

export { dockerAvailable };
