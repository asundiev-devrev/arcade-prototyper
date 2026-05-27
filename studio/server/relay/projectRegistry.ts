import { randomUUID } from "node:crypto";
import { loadProjects, saveProjects } from "./persistence";
import type { ProjectState, SharedWithEntry } from "./types";

/**
 * Project registry — in-memory index over persisted shared-project metadata.
 *
 * Replaces the per-session registry from Plan 1/2a. A project's identity
 * is the pair (hostDevu, projectSlug); the registry hands back a stable
 * `id` (UUID) for use as `projectShareId` in deep links and the relay
 * wire protocol.
 *
 * Persists to `relay/projects.json` via persistence.ts. Live WebSocket
 * connections live in `wsServer.ts`, not here.
 */

const projects = new Map<string, ProjectState>();           // id → project
const byHostSlug = new Map<string, string>();               // `${host}::${slug}` → id

export interface CreateOrGetProjectInput {
  hostDevu: string;
  projectSlug: string;
}

function key(host: string, slug: string): string {
  return `${host}::${slug}`;
}

export async function createOrGetProject(input: CreateOrGetProjectInput): Promise<ProjectState> {
  const k = key(input.hostDevu, input.projectSlug);
  const existingId = byHostSlug.get(k);
  if (existingId) {
    const existing = projects.get(existingId);
    if (existing) return existing;
  }
  const project: ProjectState = {
    id: randomUUID(),
    hostDevu: input.hostDevu,
    projectSlug: input.projectSlug,
    createdAt: new Date().toISOString(),
    shared_with: [],
  };
  projects.set(project.id, project);
  byHostSlug.set(k, project.id);
  await flush();
  return project;
}

export function getProject(id: string): ProjectState | undefined {
  return projects.get(id);
}

export function getProjectByHostSlug(hostDevu: string, projectSlug: string): ProjectState | undefined {
  const id = byHostSlug.get(`${hostDevu}::${projectSlug}`);
  if (!id) return undefined;
  return projects.get(id);
}

export function listProjects(opts: { hostDevu: string }): ProjectState[] {
  return Array.from(projects.values()).filter((p) => p.hostDevu === opts.hostDevu);
}

export interface AddCollaboratorInput {
  devu: string;
  displayName: string;
  addedBy: string;
}

export async function addCollaborator(
  projectShareId: string,
  input: AddCollaboratorInput,
): Promise<void> {
  const p = projects.get(projectShareId);
  if (!p) throw new Error(`Project ${projectShareId} not found`);
  if (p.shared_with.some((c) => c.devu === input.devu)) return;
  const entry: SharedWithEntry = {
    devu: input.devu,
    displayName: input.displayName,
    addedAt: new Date().toISOString(),
    addedBy: input.addedBy,
  };
  p.shared_with.push(entry);
  await flush();
}

export async function removeCollaborator(
  projectShareId: string,
  devu: string,
): Promise<void> {
  const p = projects.get(projectShareId);
  if (!p) return;
  p.shared_with = p.shared_with.filter((c) => c.devu !== devu);
  await flush();
}

export function isAllowed(projectShareId: string, devu: string): boolean {
  const p = projects.get(projectShareId);
  if (!p) return false;
  if (p.hostDevu === devu) return true;
  return p.shared_with.some((c) => c.devu === devu);
}

export async function hydrateProjectRegistry(): Promise<void> {
  const persisted = await loadProjects();
  projects.clear();
  byHostSlug.clear();
  for (const p of persisted) {
    projects.set(p.id, p);
    byHostSlug.set(key(p.hostDevu, p.projectSlug), p.id);
  }
}

async function flush(): Promise<void> {
  await saveProjects(Array.from(projects.values()));
}

/**
 * Boot-time helper: for every project with at least one collaborator, acquire
 * the tunnel (which publishes the rendezvous record). This is what makes
 * "host quits Studio, reopens an hour later" not break every guest mirror —
 * the new ephemeral tunnel URL gets published before any guest tries to
 * reconnect.
 *
 * Best-effort: failures are logged and ignored so a flaky network at boot
 * doesn't block the dev server from starting. Dynamic import of ./tunnel
 * breaks the circular dep (tunnel.publishHolderRendezvous calls getProject).
 */
export async function republishAllRendezvous(): Promise<void> {
  const { acquireTunnel } = await import("./tunnel");
  for (const p of projects.values()) {
    if (p.shared_with.length === 0) continue;
    try {
      await acquireTunnel(p.id);
    } catch (err: any) {
      console.warn(`[shared-projects] republish ${p.id} failed:`, err?.message ?? err);
    }
  }
}

/** Test-only: wipe in-memory state. Does NOT delete the on-disk file. */
export function __resetProjectRegistryForTests(): void {
  projects.clear();
  byHostSlug.clear();
}
