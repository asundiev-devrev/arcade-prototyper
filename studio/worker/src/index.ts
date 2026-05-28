// Arcade Studio share Worker.
//
// Proxies deploy requests from Studio clients to the Cloudflare Pages
// Direct Upload API. The Worker holds the real Cloudflare API token as a
// secret so it never leaves the Cloudflare edge.
//
// Request contract (from studio/server/cloudflare/deploy.ts):
//
//   POST /share
//   Authorization: Bearer <per-user hex key>
//   Content-Type: application/json
//   {
//     "projectSlug": string,                 // studio slug, used as branch
//     "pagesProjectName": string,            // normalized Pages project
//     "files": [{ "file": "index.html", "data": "<utf-8 text>" }, ...]
//   }
//
// Response (success):
//   200 { "url": "https://<branch>.<project>.pages.dev", "deployId": "..." }
//
// Response (failure):
//   4xx/5xx { "error": { "code": "...", "message": "..." } }

export interface Env {
  CF_API_TOKEN: string;     // secret
  ALLOWED_KEYS: string;     // secret, comma-separated hex strings
  CF_ACCOUNT_ID: string;    // var
  ACCESS_POLICY_ID: string; // var — reusable Access policy, allowlist for shared frames
  KV_RENDEZVOUS: KVNamespace;
}

interface ShareRequest {
  projectSlug: string;
  pagesProjectName: string;
  branch: string;
  files: Array<{ file: string; data: string }>;
}

const CF_API = "https://api.cloudflare.com/client/v4";

// Validation regexes for the rendezvous routes. Defined at module scope so
// the route handler doesn't recompile them on every request.
const VALID_SHARE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RELAY_RE = /^wss:\/\/[a-z0-9-]+\.trycloudflare\.com\/api\/multiplayer\/ws$/i;
const VALID_DEVU_RE = /^don:identity:[a-z0-9-]+:devo\/\d+:devu\/\d+$/i;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // CORS preflight — Studio runs on http://localhost:5556 and talks to
    // the Worker directly from the browser via fetch. Without this,
    // browsers reject the actual POST with a CORS error before it ever
    // hits the Worker.
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    const url = new URL(req.url);

    // Public landing page for multiplayer invites. When a host @-mentions
    // a teammate in Studio, the DM link points here instead of the raw
    // `arcade-studio://` scheme. This page tries to open Studio first,
    // then falls back to a download-and-install prompt if nothing handles
    // the scheme within a few seconds. No auth — URLs are unguessable
    // (UUID session ids) and anyone with the link is already an invitee.
    if (req.method === "GET") {
      const projectMatch = /^\/project\/([a-zA-Z0-9-]+)\/?$/.exec(url.pathname);
      if (projectMatch) {
        const projectShareId = projectMatch[1];
        const relay = url.searchParams.get("relay") ?? "";
        const host = url.searchParams.get("host") ?? "";
        const hostName = url.searchParams.get("hostName") ?? "your teammate";
        const projectSlug = url.searchParams.get("projectSlug") ?? "";
        return new Response(
          renderProjectLandingPage({ projectShareId, relay, host, hostName, projectSlug }),
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }

      const joinMatch = /^\/join\/([a-zA-Z0-9-]+)\/?$/.exec(url.pathname);
      if (joinMatch) {
        const sessionId = joinMatch[1];
        const relay = url.searchParams.get("relay") ?? "";
        return new Response(renderJoinLandingPage(sessionId, relay), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    // ---- rendezvous routes ------------------------------------------------
    // GET/POST /rendezvous/:shareId — host Studios publish their current relay
    // URL here on tunnel acquire and on every boot; guests fetch it before
    // opening the multiplayer WS. Backed by Workers KV with a 7-day TTL.
    const rendezvousMatch = /^\/rendezvous\/([^\/]+)\/?$/.exec(url.pathname);
    if (rendezvousMatch) {
      // Authenticate before validating the shareId — unauthenticated callers
      // shouldn't be able to probe whether a given shareId would be
      // syntactically accepted.
      const authCheck = checkBearer(req, env);
      if (authCheck) return cors(authCheck);
      const shareId = rendezvousMatch[1];
      if (!VALID_SHARE_ID_RE.test(shareId)) {
        return cors(json(400, { error: { code: "bad_share_id", message: "shareId must be a UUID" } }));
      }

      if (req.method === "GET") {
        const raw = await env.KV_RENDEZVOUS.get(`r:${shareId}`);
        if (!raw) return cors(json(404, { error: { code: "not_found", message: "No rendezvous for shareId" } }));
        return cors(new Response(raw, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }

      if (req.method === "POST") {
        let body: any;
        try { body = await req.json(); } catch {
          return cors(json(400, { error: { code: "bad_json", message: "Body is not valid JSON" } }));
        }
        const relayUrl = String(body?.relayUrl ?? "");
        const hostDevu = String(body?.hostDevu ?? "");
        const hostDisplayName = String(body?.hostDisplayName ?? "");
        if (!VALID_RELAY_RE.test(relayUrl)) {
          return cors(json(400, { error: { code: "bad_relay_url", message: "relayUrl must be wss://*.trycloudflare.com/api/multiplayer/ws" } }));
        }
        if (!VALID_DEVU_RE.test(hostDevu)) {
          return cors(json(400, { error: { code: "bad_host_devu", message: "hostDevu must look like don:identity:..." } }));
        }
        if (!hostDisplayName || hostDisplayName.length > 200) {
          return cors(json(400, { error: { code: "bad_host_name", message: "hostDisplayName 1..200 chars" } }));
        }
        const record = {
          shareId,
          relayUrl,
          hostDevu,
          hostDisplayName,
          publishedAt: Date.now(),
        };
        // 7-day TTL — host republishes on every boot, so this only matters
        // when the host hasn't been online for a week.
        await env.KV_RENDEZVOUS.put(`r:${shareId}`, JSON.stringify(record), {
          expirationTtl: 7 * 24 * 60 * 60,
        });
        return cors(new Response(null, { status: 204 }));
      }

      return cors(json(405, { error: { code: "method_not_allowed", message: "GET or POST only" } }));
    }

    if (req.method !== "POST" || url.pathname !== "/share") {
      return cors(json(404, { error: { code: "not_found", message: "POST /share, GET /project/<id>, or GET /join/<id> only" } }));
    }

    // ---- auth -------------------------------------------------------------
    const authCheck = checkBearer(req, env);
    if (authCheck) return cors(authCheck);

    // ---- body -------------------------------------------------------------
    let body: ShareRequest;
    try {
      body = (await req.json()) as ShareRequest;
    } catch {
      return cors(json(400, { error: { code: "bad_json", message: "Request body is not valid JSON" } }));
    }

    if (!body?.pagesProjectName || !body?.branch || !Array.isArray(body?.files) || body.files.length === 0) {
      return cors(json(400, {
        error: {
          code: "bad_request",
          message: "pagesProjectName, branch, and non-empty files[] are required",
        },
      }));
    }

    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
      return cors(json(500, {
        error: {
          code: "worker_misconfigured",
          message: "Worker is missing CF_API_TOKEN or CF_ACCOUNT_ID",
        },
      }));
    }

    // ---- ensure project --------------------------------------------------
    // Pages projects are cheap and idempotent — create on every request,
    // swallow 409 "already exists". Keeping this in the Worker means
    // Studio clients never need to know whether a project exists yet.
    const createRes = await fetch(
      `${CF_API}/accounts/${env.CF_ACCOUNT_ID}/pages/projects`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.CF_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: body.pagesProjectName,
          production_branch: "main",
        }),
      },
    );
    if (!createRes.ok && createRes.status !== 409) {
      const raw = await createRes.text().catch(() => "");
      return cors(json(502, {
        error: {
          code: "project_create_failed",
          message: `Cloudflare project create failed: ${createRes.status} ${raw}`,
        },
      }));
    }

    // ---- ensure Access application --------------------------------------
    // Gate every deployed URL behind an OTP wall that only @devrev.ai can
    // pass through. We don't own the pages.dev zone, so a single
    // *.pages.dev app isn't allowed — we create one Access Application
    // per Pages project instead, scoped to `<project>.pages.dev` and
    // `*.<project>.pages.dev` (for branch aliases). Idempotent: match by
    // name, skip the create if it already exists.
    //
    // Failure here is non-fatal — we log and continue to deploy. A broken
    // Access call shouldn't prevent shares from going out; the URL just
    // stays public in that window. The Worker operator notices in the
    // dashboard at leisure.
    try {
      await ensureAccessApp({
        accountId: env.CF_ACCOUNT_ID,
        token: env.CF_API_TOKEN,
        policyId: env.ACCESS_POLICY_ID,
        pagesProjectName: body.pagesProjectName,
      });
    } catch (err: any) {
      console.warn(`[access] ensureAccessApp failed: ${err?.message ?? err}`);
    }

    // ---- deploy ----------------------------------------------------------
    // Cloudflare Pages Direct Upload is a THREE-step flow. An earlier
    // version of this Worker tried to send everything in one multipart
    // POST to `/pages/projects/:name/deployments` — the API returned 200
    // and a deployment ID, but the assets never actually landed in
    // Cloudflare's asset store, so every URL served HTTP 500 when you
    // opened it. The correct sequence:
    //
    //   1. POST /accounts/:acct/pages/projects/:name/upload-token
    //      → returns { jwt } good for ~5 minutes.
    //   2. For each file, compute a content hash (sha256, hex, first 32
    //      chars — that's what Cloudflare keys its asset store by), then
    //      POST the base64 payloads to:
    //         POST https://api.cloudflare.com/client/v4/pages/assets/upload
    //         Authorization: Bearer <jwt from step 1>
    //         Content-Type: application/json
    //         Body: [{ key, value (base64), metadata: { contentType },
    //                  base64: true }]
    //      The response includes `result.successful_key_ids` — the hashes
    //      Cloudflare accepted.
    //   3. POST /accounts/:acct/pages/projects/:name/deployments with the
    //      manifest as multipart form data, where manifest is
    //      { "/path": hash } using the SAME hash we uploaded under.
    //
    // Keys are content-addressed, so re-deploying an unchanged bundle is
    // cheap (step 2 returns fast because Cloudflare sees the hash is
    // already present) and Pages dedupes across projects.

    // Step 1: get the asset upload JWT.
    const tokenRes = await fetch(
      `${CF_API}/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${body.pagesProjectName}/upload-token`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}` },
      },
    );
    if (!tokenRes.ok) {
      const raw = await tokenRes.text().catch(() => "");
      return cors(json(502, {
        error: {
          code: "upload_token_failed",
          message: `Cloudflare upload-token failed: ${tokenRes.status} ${raw}`,
        },
      }));
    }
    const tokenPayload: any = await tokenRes.json();
    const jwt: string = tokenPayload?.result?.jwt;
    if (!jwt) {
      return cors(json(502, {
        error: {
          code: "upload_token_missing",
          message: "Cloudflare returned no JWT on upload-token",
        },
      }));
    }

    // Build content-addressed keys and the manifest in one pass. The
    // "key" Cloudflare uses is a 32-character hex hash of the file
    // contents. We use sha256 and truncate — this matches what the
    // wrangler CLI does when it talks to the same endpoint.
    const manifest: Record<string, string> = {};
    const uploads: Array<{
      key: string;
      value: string;            // base64 of the file body
      metadata: { contentType: string };
      base64: true;
    }> = [];
    for (const f of body.files) {
      const key = (await sha256Hex(f.data)).slice(0, 32);
      manifest[`/${f.file}`] = key;
      uploads.push({
        key,
        value: btoa(unescape(encodeURIComponent(f.data))),
        metadata: { contentType: guessMime(f.file) },
        base64: true,
      });
    }

    // Step 2: upload the assets. Pages accepts up to 5000 files per call
    // but caps payload size per request — our bundles are tiny (usually
    // 4–6 files, < 1 MB total) so a single POST is always enough.
    const assetsRes = await fetch(`${CF_API}/pages/assets/upload`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(uploads),
    });
    if (!assetsRes.ok) {
      const raw = await assetsRes.text().catch(() => "");
      return cors(json(502, {
        error: {
          code: "asset_upload_failed",
          message: `Cloudflare asset upload failed: ${assetsRes.status} ${raw}`,
        },
      }));
    }

    // Step 3: create the deployment. The `manifest` form field carries
    // the { path: hash } map — Cloudflare reads the hashes, looks them
    // up in the asset store populated by step 2, and wires them into a
    // new deployment. `branch` produces the stable alias URL.
    const deployForm = new FormData();
    deployForm.append("manifest", JSON.stringify(manifest));
    deployForm.append("branch", body.branch);

    const deployRes = await fetch(
      `${CF_API}/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${body.pagesProjectName}/deployments`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}` },
        body: deployForm,
      },
    );

    if (!deployRes.ok) {
      const raw = await deployRes.text().catch(() => "");
      return cors(json(502, {
        error: {
          code: "deploy_failed",
          message: `Cloudflare deploy failed: ${deployRes.status} ${raw}`,
        },
      }));
    }

    const payload: any = await deployRes.json().catch(() => ({}));
    if (payload?.success !== true) {
      return cors(json(502, {
        error: {
          code: "deploy_failed",
          message: `Cloudflare deploy failed: ${JSON.stringify(payload?.errors ?? payload)}`,
        },
      }));
    }

    const result = payload.result;
    // Prefer the stable branch alias so re-shares of the same frame hit the
    // same URL. The per-deploy URL (`<hash>.<project>.pages.dev`) is our
    // fallback for deploys that somehow come back without aliases.
    const aliasUrl: string | undefined = Array.isArray(result?.aliases)
      ? result.aliases[0]
      : undefined;
    const rawUrl = aliasUrl ?? String(result?.url ?? "");
    const deployUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

    return cors(json(200, { url: deployUrl, deployId: String(result?.id ?? "") }));
  },
};

// Verify a request's Bearer token against ALLOWED_KEYS. Returns null on
// success (caller continues) or a 401 Response on failure (caller should
// `return cors(...)` it). Shared by /share and /rendezvous so both routes
// stay in lockstep on auth behavior.
function checkBearer(req: Request, env: Env): Response | null {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) {
    return json(401, { error: { code: "missing_key", message: "Missing Authorization: Bearer <key>" } });
  }
  const providedKey = match[1].trim();
  const allowed = new Set(
    (env.ALLOWED_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean),
  );
  if (!allowed.has(providedKey)) {
    return json(401, { error: { code: "invalid_key", message: "Share key is not recognized" } });
  }
  return null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cors(res: Response): Response {
  // Studio is a localhost desktop app; nobody else should be calling this
  // Worker from a browser. We still echo the origin so the dev server's
  // fetches work and so we could tighten this later (e.g. by checking
  // against a specific origin) without re-deploying clients.
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return res;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function guessMime(filename: string): string {
  if (filename.endsWith(".html")) return "text/html";
  if (filename.endsWith(".js")) return "application/javascript";
  if (filename.endsWith(".css")) return "text/css";
  if (filename.endsWith(".json")) return "application/json";
  if (filename.endsWith(".xml")) return "application/xml";
  return "application/octet-stream";
}

// Idempotently ensures a Cloudflare Access Application (self-hosted,
// OTP-gated) sits in front of the given Pages project's `pages.dev`
// hostnames, attached to a shared reusable policy. Matches by a
// deterministic app name so re-running is a no-op once created.
//
// Why per-project apps: Cloudflare won't let us register `*.pages.dev`
// as an Access app domain because we don't own the pages.dev zone
// (returns `access.api.error.invalid_request: domain does not belong to
// zone`). One Access app per Pages project is the canonical workaround.
//
// Why a shared reusable policy: without it, adding an external reviewer
// would mean editing the allowlist on every project's app one-by-one.
// With it, the operator edits ONE policy in the Zero Trust dashboard
// and every current and future project picks up the change immediately
// — no redeploy, no per-project clicks.
async function ensureAccessApp({
  accountId,
  token,
  policyId,
  pagesProjectName,
}: {
  accountId: string;
  token: string;
  policyId: string;
  pagesProjectName: string;
}): Promise<void> {
  const appName = `Arcade Studio frames — ${pagesProjectName}`;

  // Step 1: look up existing Access apps by name. We page once with a big
  // per_page since this account has < 50 apps; if Studio adoption grows
  // past that we can follow `result_info.total_pages`.
  const listRes = await fetch(
    `${CF_API}/accounts/${accountId}/access/apps?per_page=100`,
    { headers: { "Authorization": `Bearer ${token}` } },
  );
  if (!listRes.ok) {
    const raw = await listRes.text().catch(() => "");
    throw new Error(`Access list failed: ${listRes.status} ${raw}`);
  }
  const listBody: any = await listRes.json();
  const apps: Array<{ id: string; name: string }> = listBody?.result ?? [];
  const existing = apps.find((a) => a.name === appName);
  if (existing) {
    // App already exists — re-PUT it to reconcile its `policies` list to
    // the current policy ID. Catches the case where we migrated from
    // inline policies to a shared reusable policy: the app was created
    // under the old scheme, but its next share now updates it to point
    // at the shared policy without any manual dashboard cleanup.
    // Cloudflare's apps API is strict about which fields a PUT expects,
    // so we fetch the current shape first and just overwrite `policies`.
    const getRes = await fetch(
      `${CF_API}/accounts/${accountId}/access/apps/${existing.id}`,
      { headers: { "Authorization": `Bearer ${token}` } },
    );
    if (!getRes.ok) return; // Non-fatal; try again next share.
    const getBody: any = await getRes.json();
    const app = getBody?.result;
    if (!app) return;

    const currentPolicyIds: string[] = Array.isArray(app.policies)
      ? app.policies.map((p: any) => (typeof p === "string" ? p : p?.id)).filter(Boolean)
      : [];
    if (currentPolicyIds.length === 1 && currentPolicyIds[0] === policyId) return;

    await fetch(
      `${CF_API}/accounts/${accountId}/access/apps/${existing.id}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: app.name,
          type: app.type,
          session_duration: app.session_duration,
          domain: app.domain,
          self_hosted_domains: app.self_hosted_domains,
          policies: [policyId],
        }),
      },
    );
    return;
  }

  // Step 2: create the Access app covering both the apex alias host
  // (`<project>.pages.dev` — Cloudflare's stable URL) and the branch
  // wildcard (`*.<project>.pages.dev` — where our per-frame alias URLs
  // live, e.g. `01-signin.<project>.pages.dev`). `policies` references
  // the shared reusable policy so we don't embed a copy on each app.
  const createAppRes = await fetch(
    `${CF_API}/accounts/${accountId}/access/apps`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: appName,
        type: "self_hosted",
        session_duration: "24h",
        domain: `${pagesProjectName}.pages.dev`,
        self_hosted_domains: [
          `${pagesProjectName}.pages.dev`,
          `*.${pagesProjectName}.pages.dev`,
        ],
        policies: [policyId],
        // Leave identity providers empty → Cloudflare uses all account
        // providers, which at minimum includes the One-time PIN method
        // already configured on this account. That's what produces the
        // OTP email flow without us having to wire up a specific IdP id.
      }),
    },
  );
  if (!createAppRes.ok) {
    const raw = await createAppRes.text().catch(() => "");
    throw new Error(`Access app create failed: ${createAppRes.status} ${raw}`);
  }
}

/**
 * Landing page for multiplayer invites. Served from the share Worker at
 * `GET /join/<sessionId>?relay=<url>`. The page tries to launch Arcade
 * Studio via the `arcade-studio://` URL scheme on load. If Studio is not
 * installed (or the scheme handler doesn't fire within ~2s), it shows
 * an install prompt with a direct link to the latest DMG.
 *
 * Session IDs are UUIDs from Studio's relay session registry; the relay
 * URL is the host's ephemeral `*.trycloudflare.com` tunnel. Both values
 * are URL-encoded into the arcade-studio:// deep link client-side.
 *
 * Safe: escapes both params into HTML attributes + JS strings.
 */
function renderJoinLandingPage(sessionId: string, relayUrl: string): string {
  const RELEASES_URL = "https://github.com/asundiev-devrev/arcade-studio-releases/releases/latest";
  const MIN_VERSION = "0.18";
  const escHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escJs = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\u003c");

  const deepLink = `arcade-studio://session/${encodeURIComponent(sessionId)}?relay=${encodeURIComponent(relayUrl)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Join Arcade Studio session</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    background: #fceade;
    color: #2a1a3d;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: white;
    border-radius: 12px;
    padding: 32px;
    max-width: 480px;
    width: 100%;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; }
  p { margin: 0 0 16px; line-height: 1.5; color: #4a3a5d; }
  .muted { font-size: 13px; color: #6a5a7d; }
  .btn {
    display: inline-block;
    padding: 10px 16px;
    background: #7c3aed;
    color: white;
    text-decoration: none;
    border-radius: 8px;
    font-weight: 500;
    margin-top: 8px;
    border: none;
    cursor: pointer;
    font-size: 14px;
  }
  .btn:hover { background: #6d28d9; }
  .btn-secondary {
    background: transparent;
    color: #7c3aed;
    border: 1px solid #7c3aed;
  }
  .btn-secondary:hover { background: #f5f0fa; }
  #install-prompt { display: none; margin-top: 24px; padding-top: 20px; border-top: 1px solid #eee4d4; }
  code { font-size: 12px; padding: 2px 6px; background: #f5f0fa; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, monospace; }
</style>
</head>
<body>
  <div class="card">
    <h1>Opening Arcade Studio…</h1>
    <p id="status">You've been invited to a live prototype session. If Arcade Studio is installed, it should open automatically.</p>
    <p class="muted">Session: <code>${escHtml(sessionId)}</code></p>
    <button class="btn" id="retry">Try opening again</button>

    <div id="install-prompt">
      <h1 style="font-size: 18px; margin-top: 0;">Don't have Arcade Studio yet?</h1>
      <p>You'll need version ${escHtml(MIN_VERSION)} or later to join.</p>
      <a class="btn" href="${escHtml(RELEASES_URL)}" target="_blank" rel="noopener">Download Arcade Studio</a>
      <a class="btn btn-secondary" id="try-again" href="#">Already installed — try again</a>
    </div>
  </div>

<script>
(function(){
  // Cold-launch timing: on a freshly installed Studio, macOS routes the
  // deep link to the app, but the launcher's Vite boot takes 5–15s before
  // it actually serves localhost:5556. During that window the app window
  // is blank and macOS may show a "not responding" dialog. We wait long
  // enough for that boot to finish before surfacing the install prompt,
  // and we re-fire the scheme mid-wait in case the user installed Studio
  // while this page was already open.
  var deepLink = '${escJs(deepLink)}';
  var status = document.getElementById('status');
  var shown = false;
  function showInstall() {
    if (shown) return;
    shown = true;
    document.getElementById('install-prompt').style.display = 'block';
  }
  function fireScheme() {
    window.location.href = deepLink;
  }
  function retryFlow() {
    fireScheme();
    status.textContent = 'Opening Arcade Studio… first launch can take 10–15 seconds while the app starts up.';
    setTimeout(function() {
      if (shown) return;
      fireScheme();
    }, 8000);
    setTimeout(function() {
      status.textContent = 'Still working on it — the app is starting up.';
    }, 3000);
    setTimeout(showInstall, 18000);
  }
  document.getElementById('retry').addEventListener('click', retryFlow);
  document.getElementById('try-again').addEventListener('click', function(e) {
    e.preventDefault();
    retryFlow();
  });
  retryFlow();
})();
</script>
</body>
</html>`;
}

/**
 * Landing page for shared-project invites (Plan 2b). Served from the
 * share Worker at `GET /project/<shareId>?relay=…&host=…&hostName=…&projectSlug=…`.
 *
 * Mirrors the join landing flow (cold-launch retry timing, install
 * prompt fallback) but builds an `arcade-studio://project/<shareId>` deep
 * link with the full set of params Studio's protocol handler expects for
 * the shared-project model.
 *
 * Coexists with `/join/<id>` for one release while we migrate clients.
 *
 * Safe: escapes every param into HTML attributes + JS strings.
 */
function renderProjectLandingPage(input: {
  projectShareId: string;
  relay: string;
  host: string;
  hostName: string;
  projectSlug: string;
}): string {
  const RELEASES_URL = "https://github.com/asundiev-devrev/arcade-studio-releases/releases/latest";
  const MIN_VERSION = "0.18";
  const escHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escJs = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\u003c");

  const deepLink =
    `arcade-studio://project/${encodeURIComponent(input.projectShareId)}` +
    `?relay=${encodeURIComponent(input.relay)}` +
    `&host=${encodeURIComponent(input.host)}` +
    `&hostName=${encodeURIComponent(input.hostName)}` +
    `&projectSlug=${encodeURIComponent(input.projectSlug)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Open shared Arcade Studio project</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; background: #fceade; color: #2a1a3d; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: white; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; }
  p { margin: 0 0 16px; line-height: 1.5; color: #4a3a5d; }
  .muted { font-size: 13px; color: #6a5a7d; }
  .btn { display: inline-block; padding: 10px 16px; background: #7c3aed; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; margin-top: 8px; border: none; cursor: pointer; font-size: 14px; }
  .btn:hover { background: #6d28d9; }
  .btn-secondary { background: transparent; color: #7c3aed; border: 1px solid #7c3aed; }
  .btn-secondary:hover { background: #f5f0fa; }
  #install-prompt { display: none; margin-top: 24px; padding-top: 20px; border-top: 1px solid #eee4d4; }
  code { font-size: 12px; padding: 2px 6px; background: #f5f0fa; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, monospace; }
</style>
</head>
<body>
  <div class="card">
    <h1>Opening Arcade Studio…</h1>
    <p id="status">${escHtml(input.hostName)} shared a project with you. If Arcade Studio is installed, it should open automatically.</p>
    <p class="muted">Project: <code>${escHtml(input.projectSlug || input.projectShareId)}</code></p>
    <button class="btn" id="retry">Try opening again</button>

    <div id="install-prompt">
      <h1 style="font-size: 18px; margin-top: 0;">Don't have Arcade Studio yet?</h1>
      <p>You'll need version ${escHtml(MIN_VERSION)} or later to open shared projects.</p>
      <a class="btn" href="${escHtml(RELEASES_URL)}" target="_blank" rel="noopener">Download Arcade Studio</a>
      <a class="btn btn-secondary" id="try-again" href="#">Already installed — try again</a>
    </div>
  </div>

<script>
(function(){
  var deepLink = '${escJs(deepLink)}';
  var status = document.getElementById('status');
  var shown = false;
  function showInstall() { if (shown) return; shown = true; document.getElementById('install-prompt').style.display = 'block'; }
  function fireScheme() { window.location.href = deepLink; }
  function retryFlow() {
    fireScheme();
    setTimeout(function() { if (shown) return; fireScheme(); }, 8000);
    setTimeout(function() { status.textContent = 'Still working on it — the app is starting up.'; }, 3000);
    setTimeout(showInstall, 18000);
  }
  document.getElementById('retry').addEventListener('click', retryFlow);
  document.getElementById('try-again').addEventListener('click', function(e) { e.preventDefault(); retryFlow(); });
  retryFlow();
})();
</script>
</body>
</html>`;
}
