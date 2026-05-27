import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMirror,
  readMirror,
  listMirrors,
  deleteMirror,
  readChat,
  readFrames,
} from "../sharedProjects/cache";
import {
  connectMirror,
  disconnectMirror,
  sendComment,
  getMirrorBus,
} from "../sharedProjects/relayClient";
import { getProjectByHostSlug } from "../relay/projectRegistry";
import { onProjectEvent } from "../relay/wsServer";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";

/**
 * Guest-side HTTP/SSE surface for shared projects (Plan 2b).
 *
 * The host owns the project; the guest holds a mirror under
 * `<studioRoot>/shared-projects/<id>/`. This middleware is the only thing
 * the React shell talks to — the live WebSocket lives in the Vite process
 * (relayClient.ts), so closing the tab does not drop the connection.
 *
 * Endpoints:
 *   GET    /api/shared-projects                — list mirrors
 *   POST   /api/shared-projects/import         — create a mirror + connectMirror
 *   GET    /api/shared-projects/:id            — meta + chat + frames
 *   POST   /api/shared-projects/:id/comment    — sendComment (queues if offline)
 *   DELETE /api/shared-projects/:id            — disconnect + delete mirror
 *   GET    /api/shared-projects/:id/stream     — SSE forwarding the mirror bus
 */

const LIST_RE = /^\/api\/shared-projects\/?$/;
const IMPORT_RE = /^\/api\/shared-projects\/import\/?$/;
const ITEM_RE = /^\/api\/shared-projects\/([^\/]+)\/?$/;
const COMMENT_RE = /^\/api\/shared-projects\/([^\/]+)\/comment\/?$/;
const STREAM_RE = /^\/api\/shared-projects\/([^\/]+)\/stream\/?$/;
const HOST_STREAM_RE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/presence-stream\/?$/i;

export function sharedProjectsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && LIST_RE.test(url)) return list(res);
    if (req.method === "POST" && IMPORT_RE.test(url)) return importMirror(req, res);
    if (req.method === "GET" && STREAM_RE.test(url)) return stream(req, res, url.match(STREAM_RE)![1]);
    if (req.method === "POST" && COMMENT_RE.test(url)) return comment(req, res, url.match(COMMENT_RE)![1]);
    if (req.method === "DELETE" && ITEM_RE.test(url)) return remove(res, url.match(ITEM_RE)![1]);
    if (req.method === "GET" && ITEM_RE.test(url)) return show(res, url.match(ITEM_RE)![1]);
    if (req.method === "GET" && HOST_STREAM_RE.test(url)) {
      return hostPresenceStream(req, res, url.match(HOST_STREAM_RE)![1]);
    }
    return next?.();
  };
}

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const c of req) buf += c;
  return buf ? JSON.parse(buf) : {};
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function list(res: ServerResponse) {
  const mirrors = await listMirrors();
  json(res, 200, { projects: mirrors });
}

async function show(res: ServerResponse, id: string) {
  const meta = await readMirror(id);
  if (!meta) return json(res, 404, { error: "not_found" });
  const [chat, frames] = await Promise.all([readChat(id), readFrames(id)]);
  json(res, 200, { metadata: meta, chat, frames });
}

async function importMirror(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readJson(req); } catch { return json(res, 400, { error: "bad_json" }); }
  // relayUrl became optional in 0.21+ — guests resolve the live URL via the
  // Worker rendezvous on every connect. Hosts on 0.20.x still send it; we
  // accept and store it as a fallback when present.
  const required = ["projectShareId", "hostDevu", "hostDisplayName", "projectSlug"];
  for (const k of required) {
    if (!body[k]) return json(res, 400, { error: `${k} required` });
  }
  await createMirror({
    id: body.projectShareId,
    relayUrl: body.relayUrl,
    hostDevu: body.hostDevu,
    hostDisplayName: body.hostDisplayName,
    projectSlug: body.projectSlug,
  });
  await connectMirror(body.projectShareId);
  json(res, 201, { id: body.projectShareId });
}

async function comment(req: IncomingMessage, res: ServerResponse, id: string) {
  let body: any;
  try { body = await readJson(req); } catch { return json(res, 400, { error: "bad_json" }); }
  const text = String(body.text ?? "").trim();
  if (!text) return json(res, 400, { error: "text required" });
  await sendComment(id, text);
  json(res, 200, { ok: true });
}

async function remove(res: ServerResponse, id: string) {
  await disconnectMirror(id);
  await deleteMirror(id);
  res.writeHead(204);
  res.end();
}

async function stream(_req: IncomingMessage, res: ServerResponse, id: string) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const bus = getMirrorBus(id);
  if (!bus) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: "no mirror" })}\n\n`);
    res.end();
    return;
  }
  const onEvent = (ev: unknown) => res.write(`event: relay\ndata: ${JSON.stringify(ev)}\n\n`);
  const onStatus = (s: string) => res.write(`event: status\ndata: ${JSON.stringify({ status: s })}\n\n`);
  bus.on("event", onEvent);
  bus.on("status", onStatus);
  res.on("close", () => {
    bus.off("event", onEvent);
    bus.off("status", onStatus);
  });
}

/**
 * Host-side presence stream — SSE feed of broadcast relay events for a
 * project the caller hosts. Lets the host's React shell render live
 * `presence_state` events without holding a WebSocket of its own (the
 * relay's host WS is owned by the Vite process).
 */
async function hostPresenceStream(
  _req: IncomingMessage,
  res: ServerResponse,
  slug: string,
) {
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  const host = pat ? await resolveDevuFromPat(pat) : null;
  if (!host) {
    res.writeHead(401);
    res.end();
    return;
  }
  const project = getProjectByHostSlug(host.id, slug);
  if (!project) {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const off = onProjectEvent(project.id, (ev) => {
    res.write(`event: relay\ndata: ${JSON.stringify(ev)}\n\n`);
  });
  res.on("close", () => off());
}
