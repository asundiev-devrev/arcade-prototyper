import type { IncomingMessage, ServerResponse } from "node:http";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";
import { createSession, addInvite } from "../relay/sessionRegistry";
import { createOrFetchDm, postToDm } from "../devrev/dm";
import { startTunnel, currentTunnelUrl } from "../relay/tunnel";
import { SHARE_WORKER_URL } from "../cloudflare/deploy";
import { listMentionableUsers } from "../devrev/devUsers";

/**
 * One-shot HTTP endpoint for starting a multiplayer invite. Composes:
 *
 *   1. Resolve the host's devu from the keychain PAT.
 *   2. Ensure a cloudflared tunnel is running (start it if not).
 *   3. Create a relay session, add the guest to its invite list.
 *   4. Create/reuse a DevRev DM between host and guest.
 *   5. Post an invite message with the arcade-studio:// deep link into the DM.
 *
 * Returns 201 with { sessionId, inviteUrl } on success. The client uses
 * sessionId to wait for the guest to connect via WebSocket.
 */

const INVITE_URL = /^\/api\/multiplayer\/invite\/?$/;
const MENTION_USERS_URL = /^\/api\/multiplayer\/mention-users\/?$/;
const STUDIO_PORT = 5556;

export function multiplayerInviteMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";

    if (req.method === "GET" && MENTION_USERS_URL.test(url)) {
      try {
        const users = await listMentionableUsers();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ users }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }

    if (req.method !== "POST" || !INVITE_URL.test(url)) return next?.();

    let body: any;
    try {
      let buf = "";
      for await (const chunk of req) buf += chunk;
      body = buf ? JSON.parse(buf) : {};
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }

    const projectSlug = typeof body.projectSlug === "string" ? body.projectSlug : "";
    const guestDevu = typeof body.guestDevu === "string" ? body.guestDevu : "";
    const guestDisplayName =
      typeof body.guestDisplayName === "string" ? body.guestDisplayName : "your teammate";
    const promptPreview = typeof body.promptPreview === "string" ? body.promptPreview : "";

    if (!projectSlug || !guestDevu) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "projectSlug and guestDevu required" }));
      return;
    }

    const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
    if (!pat) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "DevRev PAT not configured" }));
      return;
    }

    const host = await resolveDevuFromPat(pat);
    if (!host) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "DevRev PAT invalid" }));
      return;
    }

    // `currentTunnelUrl()` is the single source of truth for whether a tunnel
    // is live. When cloudflared dies mid-session it clears itself there, so
    // the next invite falls through to startTunnel and recovers automatically.
    // Keeping a separate module-level cache would reintroduce a staleness bug
    // where a dead URL gets posted into a DM.
    let tunnelUrl = currentTunnelUrl();
    if (!tunnelUrl) {
      try {
        tunnelUrl = await startTunnel({ port: STUDIO_PORT });
      } catch (err: any) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Tunnel failed: ${err?.message ?? err}` }));
        return;
      }
    }

    const session = await createSession({ hostDevu: host.id, projectSlug });
    await addInvite(session.id, { devu: guestDevu, invitedByDevu: host.id });

    // The DM invite URL is the web landing page (Worker `GET /join/<id>`),
    // not the raw `arcade-studio://` scheme. The landing page tries to
    // launch Studio automatically and falls back to an install prompt
    // for guests who don't have Studio installed. The raw deep link is
    // still returned in the response for clients (tests, future uses).
    const deepLink = `arcade-studio://session/${session.id}?relay=${encodeURIComponent(tunnelUrl)}`;
    const inviteUrl = `${SHARE_WORKER_URL}/join/${session.id}?relay=${encodeURIComponent(tunnelUrl)}`;

    const messageLines = [
      `${host.displayName} invited you to a prototype session in Arcade Studio.`,
      "",
      promptPreview ? `Starting prompt: "${promptPreview}"` : "",
      "",
      `Join: ${inviteUrl}`,
      "",
      "Requires Arcade Studio 0.18 or later. The link will try to open Studio automatically, or show you how to install it.",
    ].filter(Boolean).join("\n");

    const dmId = await createOrFetchDm(pat, host.id, guestDevu);

    try {
      await postToDm(pat, dmId, messageLines);
    } catch (err: any) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err?.message ?? "DM delivery failed" }));
      return;
    }

    void guestDisplayName; // reserved for future "invited Konstantin" toast content; not used in response body today

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      sessionId: session.id,
      inviteUrl,   // Web landing page (shown in DM)
      deepLink,    // Raw arcade-studio:// URL (for future client use)
      tunnelUrl,
      dmId,
    }));
  };
}
