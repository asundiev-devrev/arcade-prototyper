import { randomUUID } from "node:crypto";
import { loadSessions, saveSessions } from "./persistence";
import type { SessionInvite, SessionState } from "./types";

/**
 * Session registry — in-memory index over persisted session metadata.
 *
 * Responsibilities:
 *   - Create / end sessions; maintain invite lists.
 *   - Re-hydrate from disk on boot.
 *   - Provide O(1) lookup by id for the WebSocket layer.
 *
 * This file does NOT hold live WebSocket connections or the event ring
 * buffer. That lives on the WsServer (see relay/wsServer.ts). Splitting is
 * intentional: persistence concerns stay isolated from transport concerns.
 */

const sessions = new Map<string, SessionState>();

export interface CreateSessionInput {
  hostDevu: string;
  projectSlug: string;
  linkedWorkId?: string | null;
}

export async function createSession(input: CreateSessionInput): Promise<SessionState> {
  const id = randomUUID();
  const session: SessionState = {
    id,
    sessionObject: `relay-session-${id}`,
    hostDevu: input.hostDevu,
    projectSlug: input.projectSlug,
    linkedWorkId: input.linkedWorkId ?? null,
    createdAt: new Date().toISOString(),
    endedAt: null,
    invites: [],
  };
  sessions.set(id, session);
  await flush();
  return session;
}

export function getSession(id: string): SessionState | undefined {
  return sessions.get(id);
}

export function listSessions(opts?: { includeEnded?: boolean }): SessionState[] {
  const out: SessionState[] = [];
  for (const s of sessions.values()) {
    if (!opts?.includeEnded && s.endedAt) continue;
    out.push(s);
  }
  return out;
}

export async function endSession(id: string): Promise<void> {
  const existing = sessions.get(id);
  if (!existing || existing.endedAt) return;
  existing.endedAt = new Date().toISOString();
  await flush();
}

export async function addInvite(
  sessionId: string,
  invite: Omit<SessionInvite, "invitedAt">,
): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`Session ${sessionId} not found`);
  if (s.invites.some((i) => i.devu === invite.devu)) return;
  s.invites.push({ ...invite, invitedAt: new Date().toISOString() });
  await flush();
}

/**
 * Read persisted sessions into memory. Call once at Vite boot before the
 * WebSocket server starts accepting connections.
 */
export async function hydrateSessionRegistry(): Promise<void> {
  const persisted = await loadSessions();
  sessions.clear();
  for (const s of persisted) sessions.set(s.id, s);
}

async function flush(): Promise<void> {
  await saveSessions(Array.from(sessions.values()));
}

/** Test-only: wipe in-memory state. Does NOT delete the on-disk file. */
export function __resetSessionRegistryForTests(): void {
  sessions.clear();
}
