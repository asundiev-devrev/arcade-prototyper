import type { IncomingMessage, ServerResponse } from "node:http";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";
import { createSession, addInvite } from "../relay/sessionRegistry";
import { createOrFetchDm, postToDm } from "../devrev/dm";
import { startTunnel, currentTunnelUrl } from "../relay/tunnel";

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
const STUDIO_PORT = 5556;

// Module-level cache of the tunnel URL. We rely on `currentTunnelUrl()` from
// relay/tunnel as the primary source, but in tests the mock returns null
// and we still want to avoid starting a second tunnel after the first succeeds.
// This cache bridges that: once we successfully start a tunnel (or see one
// running), we remember the URL here.
let cachedTunnelUrl: string | null = null;

export function multiplayerInviteMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
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

    let tunnelUrl = currentTunnelUrl() || cachedTunnelUrl;
    if (!tunnelUrl) {
      try {
        tunnelUrl = await startTunnel({ port: STUDIO_PORT });
        cachedTunnelUrl = tunnelUrl;
      } catch (err: any) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Tunnel failed: ${err?.message ?? err}` }));
        return;
      }
    }

    const session = await createSession({ hostDevu: host.id, projectSlug });
    await addInvite(session.id, { devu: guestDevu, invitedByDevu: host.id });

    const inviteUrl = `arcade-studio://session/${session.id}?relay=${encodeURIComponent(tunnelUrl)}`;

    const messageLines = [
      `${host.displayName} invited you to a prototype session in Arcade Studio.`,
      "",
      promptPreview ? `Starting prompt: "${promptPreview}"` : "",
      "",
      `Open: ${inviteUrl}`,
      "",
      "(Requires Arcade Studio 0.15+. https://github.com/asundiev-devrev/arcade-studio-releases)",
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
      inviteUrl,
      tunnelUrl,
      dmId,
    }));
  };
}

/** Test-only: clear the cached tunnel URL so tests start from a clean slate. */
export function __resetMultiplayerInviteForTests(): void {
  cachedTunnelUrl = null;
}
