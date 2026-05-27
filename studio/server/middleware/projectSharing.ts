import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";
import {
  createOrGetProject,
  getProject,
  addCollaborator,
  removeCollaborator,
  listProjects,
} from "../relay/projectRegistry";
import { acquireTunnel, releaseTunnel, currentTunnelUrl } from "../relay/tunnel";
import { createOrFetchDm, postToDm } from "../devrev/dm";
import { SHARE_WORKER_URL } from "../cloudflare/deploy";
import { multiplayerJsonPath } from "../paths";

/**
 * HTTP endpoints for the host's Share panel:
 *
 *   POST   /api/projects/:slug/collaborators        → add a collaborator
 *                                                     (composes project
 *                                                     registry → tunnel
 *                                                     acquire → write
 *                                                     multiplayer.json → DM
 *                                                     the invite link).
 *   GET    /api/projects/:slug/collaborators        → list current
 *                                                     collaborators.
 *   DELETE /api/projects/:slug/collaborators/:devu  → remove a collaborator.
 *                                                     Releases the tunnel ref
 *                                                     if this was the last
 *                                                     collaborator.
 *   GET    /api/projects/:slug/collaborators/link   → fresh share-link URL for
 *                                                     the "copy link"
 *                                                     affordance.
 *
 * NOTE: These were originally `/share` and `/share/:devu`, which collided with
 * the pre-existing `POST /api/projects/:slug/share` route handled by
 * `cloudflareMiddleware` (frame deploy to Cloudflare Pages). The collision
 * caused beta users to see "Deploy failed: 400" because this middleware ran
 * first and rejected the deploy body for missing `devu`. Renamed in 0.20.2.
 */

const SHARE_RE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/collaborators\/?$/i;
const SHARE_DEVU_RE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/collaborators\/(.+)$/i;
const LINK_RE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/collaborators\/link\/?$/i;

export function projectSharingMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";

    if (req.method === "GET" && LINK_RE.test(url)) {
      return handleGetLink(req, res, url.match(LINK_RE)![1]);
    }
    if (req.method === "GET" && SHARE_RE.test(url)) {
      return handleGetShare(req, res, url.match(SHARE_RE)![1]);
    }
    if (req.method === "POST" && SHARE_RE.test(url)) {
      return handlePostShare(req, res, url.match(SHARE_RE)![1]);
    }
    if (req.method === "DELETE" && SHARE_DEVU_RE.test(url)) {
      const m = url.match(SHARE_DEVU_RE)!;
      return handleDeleteShare(req, res, m[1], decodeURIComponent(m[2]));
    }
    return next?.();
  };
}

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const c of req) buf += c;
  return buf ? JSON.parse(buf) : {};
}

function jsonResponse(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function getHostIdentity(): Promise<{ id: string; displayName: string } | null> {
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  if (!pat) return null;
  return resolveDevuFromPat(pat);
}

async function writeMultiplayerJson(slug: string, projectShareId: string, sharedWith: any[]) {
  const file = multiplayerJsonPath(slug);
  const body = { version: 1, projectShareId, shared_with: sharedWith };
  await fs.writeFile(file, JSON.stringify(body, null, 2), "utf-8");
}

async function handleGetShare(_req: IncomingMessage, res: ServerResponse, slug: string) {
  const host = await getHostIdentity();
  if (!host) return jsonResponse(res, 401, { error: "DevRev PAT not configured" });
  const projects = listProjects({ hostDevu: host.id });
  const project = projects.find((p) => p.projectSlug === slug);
  if (!project) return jsonResponse(res, 200, { shared_with: [] });
  return jsonResponse(res, 200, {
    projectShareId: project.id,
    shared_with: project.shared_with,
  });
}

async function handlePostShare(req: IncomingMessage, res: ServerResponse, slug: string) {
  let body: any;
  try {
    body = await readJson(req);
  } catch {
    return jsonResponse(res, 400, { error: "invalid JSON body" });
  }
  const devu = String(body.devu ?? "");
  const displayName = String(body.displayName ?? "your teammate");
  if (!devu) return jsonResponse(res, 400, { error: "devu required" });

  const host = await getHostIdentity();
  if (!host) return jsonResponse(res, 401, { error: "DevRev PAT not configured" });

  const project = await createOrGetProject({ hostDevu: host.id, projectSlug: slug });
  await addCollaborator(project.id, { devu, displayName, addedBy: host.id });

  let tunnelUrl: string;
  try {
    tunnelUrl = await acquireTunnel(project.id);
  } catch (err: any) {
    return jsonResponse(res, 502, { error: `Tunnel failed: ${err?.message ?? err}` });
  }

  await writeMultiplayerJson(slug, project.id, getProject(project.id)!.shared_with);

  const inviteUrl = `${SHARE_WORKER_URL}/project/${project.id}?relay=${encodeURIComponent(
    tunnelUrl,
  )}&host=${encodeURIComponent(host.id)}&hostName=${encodeURIComponent(
    host.displayName,
  )}&projectSlug=${encodeURIComponent(slug)}`;

  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  const dmId = await createOrFetchDm(pat, host.id, devu);
  const messageLines = [
    `${host.displayName} shared an Arcade Studio project with you.`,
    "",
    `[Open project](${inviteUrl})`,
    "",
    "Requires Arcade Studio 0.18 or later. The link will try to open Studio automatically, or show you how to install it.",
  ].join("\n");
  try {
    await postToDm(pat, dmId, messageLines);
  } catch (err: any) {
    return jsonResponse(res, 502, { error: err?.message ?? "DM delivery failed" });
  }

  return jsonResponse(res, 201, {
    projectShareId: project.id,
    inviteUrl,
    tunnelUrl,
    dmId,
  });
}

async function handleDeleteShare(
  _req: IncomingMessage,
  res: ServerResponse,
  slug: string,
  devu: string,
) {
  const host = await getHostIdentity();
  if (!host) return jsonResponse(res, 401, { error: "DevRev PAT not configured" });
  const projects = listProjects({ hostDevu: host.id });
  const project = projects.find((p) => p.projectSlug === slug);
  if (!project) {
    res.writeHead(204);
    res.end();
    return;
  }
  await removeCollaborator(project.id, devu);
  await writeMultiplayerJson(slug, project.id, getProject(project.id)!.shared_with);
  if (getProject(project.id)!.shared_with.length === 0) {
    await releaseTunnel(project.id);
  }
  res.writeHead(204);
  res.end();
}

async function handleGetLink(_req: IncomingMessage, res: ServerResponse, slug: string) {
  const host = await getHostIdentity();
  if (!host) return jsonResponse(res, 401, { error: "DevRev PAT not configured" });
  const projects = listProjects({ hostDevu: host.id });
  const project = projects.find((p) => p.projectSlug === slug);
  if (!project) return jsonResponse(res, 404, { error: "project not shared" });
  const tunnelUrl = currentTunnelUrl();
  if (!tunnelUrl) return jsonResponse(res, 503, { error: "tunnel offline" });
  const inviteUrl = `${SHARE_WORKER_URL}/project/${project.id}?relay=${encodeURIComponent(
    tunnelUrl,
  )}&host=${encodeURIComponent(host.id)}&hostName=${encodeURIComponent(
    host.displayName,
  )}&projectSlug=${encodeURIComponent(slug)}`;
  return jsonResponse(res, 200, { inviteUrl });
}
