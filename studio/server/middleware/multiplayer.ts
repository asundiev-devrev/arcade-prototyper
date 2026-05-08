import type { IncomingMessage, ServerResponse } from "node:http";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";
import {
  createSession,
  getSession,
  listSessions,
  endSession,
  addInvite,
} from "../relay/sessionRegistry";

/**
 * HTTP middleware for multiplayer session lifecycle.
 *
 *   POST   /api/multiplayer/sessions              → create a session (host's PAT from keychain)
 *   GET    /api/multiplayer/sessions              → list active sessions
 *   POST   /api/multiplayer/sessions/:id/invite   → add a devu to the invite list
 *   POST   /api/multiplayer/sessions/:id/end      → end the session
 *
 * Auth: the host's DevRev PAT is read from the keychain (same pattern as
 * middleware/devrev.ts). Guests do NOT authenticate via this middleware —
 * they authenticate on the WebSocket upgrade (see relay/wsServer.ts).
 */

const CREATE_URL = /^\/api\/multiplayer\/sessions\/?$/;
const INVITE_URL = /^\/api\/multiplayer\/sessions\/([a-f0-9-]+)\/invite\/?$/;
const END_URL    = /^\/api\/multiplayer\/sessions\/([a-f0-9-]+)\/end\/?$/;

export function multiplayerMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/multiplayer/")) return next?.();

    if (req.method === "GET" && CREATE_URL.test(url)) return handleList(res);
    if (req.method === "POST" && CREATE_URL.test(url)) return handleCreate(req, res);

    const invite = url.match(INVITE_URL);
    if (req.method === "POST" && invite) return handleInvite(req, res, invite[1]);

    const end = url.match(END_URL);
    if (req.method === "POST" && end) return handleEnd(res, end[1]);

    return next?.();
  };
}

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  if (!buf) return {};
  try { return JSON.parse(buf); } catch { return {}; }
}

async function resolveHostDevu(): Promise<{ id: string; displayName: string } | null> {
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  if (!pat) return null;
  return resolveDevuFromPat(pat);
}

async function handleCreate(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const projectSlug = typeof body.projectSlug === "string" ? body.projectSlug : "";
  const linkedWorkId = typeof body.linkedWorkId === "string" ? body.linkedWorkId : null;

  if (!projectSlug) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "projectSlug required" }));
    return;
  }

  const host = await resolveHostDevu();
  if (!host) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "DevRev PAT not configured or invalid" }));
    return;
  }

  const session = await createSession({
    hostDevu: host.id,
    projectSlug,
    linkedWorkId,
  });
  // Auto-invite the host so they can immediately join.
  await addInvite(session.id, { devu: host.id, invitedByDevu: host.id });

  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    sessionId: session.id,
    sessionObject: session.sessionObject,
    hostDevu: session.hostDevu,
  }));
}

function handleList(res: ServerResponse) {
  const sessions = listSessions().map((s) => ({
    id: s.id,
    projectSlug: s.projectSlug,
    sessionObject: s.sessionObject,
    createdAt: s.createdAt,
    invites: s.invites,
    linkedWorkId: s.linkedWorkId,
  }));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ sessions }));
}

async function handleInvite(req: IncomingMessage, res: ServerResponse, id: string) {
  const host = await resolveHostDevu();
  if (!host) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "DevRev PAT not configured or invalid" }));
    return;
  }
  const session = getSession(id);
  if (!session || session.endedAt) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return;
  }
  if (session.hostDevu !== host.id) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Only the host can invite" }));
    return;
  }

  const body = await readJson(req);
  const devu = typeof body.devu === "string" ? body.devu : "";
  if (!devu) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "devu required" }));
    return;
  }
  await addInvite(id, { devu, invitedByDevu: host.id });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

async function handleEnd(res: ServerResponse, id: string) {
  const session = getSession(id);
  if (!session) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return;
  }
  await endSession(id);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}
