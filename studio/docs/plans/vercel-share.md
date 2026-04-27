# Vercel Share Link Integration (Feature 4.7)

## Goal

Enable one-click publishing of individual frames to Vercel preview URLs so designers can share working prototypes externally without recipients needing to run Arcade Studio locally.

## Approach

**Static Export + Vercel Deploy (v1)**

1. User clicks "Share" button in Studio header (top-right, between Light/Dark and Canvas)
2. Studio builds frame to static HTML + JS bundle using esbuild
3. Bundle deployed to Vercel via REST API (`/v13/deployments`)
4. Studio returns shareable URL: `https://arcade-<project>-<frame>.vercel.app`
5. Recipients visit URL and see the live prototype (no Studio install needed)

**Key constraints for v1:**
- Single-frame sharing only (multi-frame deferred to v1.1)
- DevRev API calls stubbed to mock data (PATs must not be deployed publicly)
- Vercel token stored in `~/Library/Application Support/arcade-studio/settings.json` (plaintext OK for v1; keychain future improvement)
- Deploy history tracked in `project.json` under `deployments[]` (UI for browsing deferred to v1.1)
- No auto-expiry; manual cleanup via Vercel dashboard

## Locked Decisions

1. **UI Placement:** `ShareButton` in `StudioHeader` right-actions slot (peer of `ThemeToggle`, `CanvasToggle`)
2. **Modal Flow:** Click Share → `ShareModal` opens → shows preview of what will deploy → "Publish" button → success screen with URL + copy button
3. **DevRev Data:** Stub to mock data. Show explicit "DevRev API calls will return mock data" warning in ShareModal for frames using DevRev helper
4. **Vercel Project:** Single Vercel project owns all Studio shares. User configures token + target project/team once in Settings
5. **Token Storage:** Global settings file (new in this plan): `~/Library/Application Support/arcade-studio/settings.json` with `chmod 600`
6. **API Choice:** Vercel REST API (`/v13/deployments`), not CLI

## Vercel API Reference

**Endpoint:** `POST https://api.vercel.com/v13/deployments`

**Auth:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "name": "arcade-my-project-frame-name",
  "files": [
    { "file": "index.html", "data": "<base64-encoded-html>" },
    { "file": "bundle.js", "data": "<base64-encoded-js>" },
    { "file": "styles.css", "data": "<base64-encoded-css>" }
  ],
  "projectSettings": { "framework": null },
  "target": "production"
}
```

**Response:** `{ "id": "dpl_abc123", "url": "arcade-proj-frame.vercel.app", "readyState": "READY" }`

**Docs:** https://vercel.com/docs/rest-api/endpoints/deployments

**Rate limits:** 100 deploys/hour (free tier), 1000/hour (Pro)

## Data Flow

1. User clicks `ShareButton` in header → `ShareModal` opens
2. Modal shows frame name + "DevRev API calls will return mock data" warning (if frame uses DevRev helper)
3. User clicks "Publish" → `POST /api/projects/:slug/frames/:frame/share`
4. `server/middleware/vercel.ts` validates token, reads frame source
5. `server/vercel/bundler.ts` builds static bundle with esbuild (frame + arcade components + tokens + stubbed APIs)
6. `server/vercel/deploy.ts` posts to Vercel API, returns URL
7. Deploy record saved to `{projectDir}/project.json` under `deployments[]`
8. Modal shows success: URL + Copy/Open buttons

## Security

**Token Storage:**
- Location: `~/Library/Application Support/arcade-studio/settings.json`
- Permissions: `chmod 600` (owner read/write only)
- Never logged or shown in UI (only "configured" status)
- Validated via `GET https://api.vercel.com/v2/user` before first deploy

**Exported Bundle:**
- DevRev PATs NEVER embedded (API calls stubbed at build time)
- Deployed frames run in isolated origin (no Studio secrets accessible)
- Vercel URLs are public; treat as semi-private (share via DM, not forums)

## File Structure

### New Files

**1. `studio/server/middleware/vercel.ts`** (120-180 lines)

Handles share API endpoints:

```typescript
import type { ViteDevServer } from "vite";
import { buildFrameBundle } from "../vercel/bundler";
import { deployToVercel } from "../vercel/deploy";
import { getSettings, validateVercelToken } from "../settings";
import { projectDir, frameDir } from "../paths";
import fs from "node:fs/promises";
import path from "node:path";

export function vercelMiddleware(server: ViteDevServer) {
  return async (req, res, next) => {
    // POST /api/projects/:slug/frames/:frame/share
    const shareMatch = req.url?.match(/^\/api\/projects\/([a-z0-9-]+)\/frames\/([a-z0-9-]+)\/share$/);
    if (shareMatch && req.method === "POST") {
      const [, slug, frameSlug] = shareMatch;
      
      try {
        // 1. Validate Vercel token
        const settings = await getSettings();
        if (!settings.vercel?.token) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Vercel token not configured. Run settings config." }));
          return;
        }
        
        const tokenValid = await validateVercelToken(settings.vercel.token);
        if (!tokenValid) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid Vercel token" }));
          return;
        }
        
        // 2. Build frame bundle
        const projectPath = projectDir(slug);
        const framePath = frameDir(slug, frameSlug);
        const projectJson = JSON.parse(await fs.readFile(path.join(projectPath, "project.json"), "utf-8"));
        const frame = projectJson.frames.find(f => f.slug === frameSlug);
        
        if (!frame) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Frame not found" }));
          return;
        }
        
        const bundle = await buildFrameBundle({
          projectSlug: slug,
          frameSlug,
          framePath,
          theme: projectJson.theme,
          mode: projectJson.mode,
        });
        
        // 3. Deploy to Vercel
        const deployment = await deployToVercel({
          name: `arcade-${slug}-${frameSlug}`,
          files: [
            { file: "index.html", data: Buffer.from(bundle.html).toString("base64") },
            { file: "bundle.js", data: Buffer.from(bundle.js).toString("base64") },
            { file: "styles.css", data: Buffer.from(bundle.css).toString("base64") },
          ],
          token: settings.vercel.token,
          team: settings.vercel.team,
        });
        
        // 4. Save deploy record to project.json
        projectJson.deployments = projectJson.deployments || [];
        projectJson.deployments.push({
          frameSlug,
          url: deployment.url,
          deployId: deployment.id,
          createdAt: new Date().toISOString(),
        });
        await fs.writeFile(path.join(projectPath, "project.json"), JSON.stringify(projectJson, null, 2));
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: `https://${deployment.url}`, deployId: deployment.id }));
      } catch (err) {
        console.error("Share failed:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    
    next();
  };
}
```

**2. `studio/server/vercel/bundler.ts`** (200-300 lines)

Bundles frame + dependencies into static files:

```typescript
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { studioRoot } from "../paths";

interface BuildContext {
  projectSlug: string;
  frameSlug: string;
  framePath: string;
  theme: "arcade" | "devrev-app";
  mode: "light" | "dark";
}

export async function buildFrameBundle(ctx: BuildContext): Promise<{
  html: string;
  js: string;
  css: string;
}> {
  // 1. Read frame source
  const frameSource = await fs.readFile(path.join(ctx.framePath, "index.tsx"), "utf-8");
  
  // 2. Create entrypoint that wraps frame with DevRevThemeProvider
  const entrypoint = `
    import React from "react";
    import ReactDOM from "react-dom/client";
    import { DevRevThemeProvider } from "arcade/theme/DevRevThemeProvider";
    import Frame from "${ctx.framePath}/index.tsx";
    import "arcade/styles/globals.css";
    import "arcade/styles/typography.css";
    import "arcade/tokens/generated/core.css";
    import "arcade/tokens/generated/${ctx.mode}.css";
    import "arcade/tokens/generated/component.css";
    
    // Stub DevRev API calls (no real API in static export)
    window.fetch = new Proxy(window.fetch, {
      apply(target, thisArg, args) {
        const url = args[0];
        if (typeof url === "string" && url.includes("/api/devrev/")) {
          console.warn("[Static Export] DevRev API calls are stubbed:", url);
          return Promise.resolve(new Response(JSON.stringify({ stubbed: true }), { status: 200 }));
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
    
    ReactDOM.createRoot(document.getElementById("root")).render(
      <React.StrictMode>
        <DevRevThemeProvider mode="${ctx.mode}">
          <Frame />
        </DevRevThemeProvider>
      </React.StrictMode>
    );
  `;
  
  // 3. Write temp entrypoint
  const tempDir = path.join(studioRoot(), ".temp", `build-${ctx.projectSlug}-${ctx.frameSlug}`);
  await fs.mkdir(tempDir, { recursive: true });
  const entrypointPath = path.join(tempDir, "entrypoint.tsx");
  await fs.writeFile(entrypointPath, entrypoint);
  
  // 4. Build with esbuild
  const result = await build({
    entryPoints: [entrypointPath],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    outdir: tempDir,
    write: false,
    loader: {
      ".tsx": "tsx",
      ".ts": "ts",
      ".css": "css",
    },
    external: [], // Bundle everything
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
  });
  
  // 5. Extract outputs
  const jsOutput = result.outputFiles.find(f => f.path.endsWith(".js"));
  const cssOutput = result.outputFiles.find(f => f.path.endsWith(".css"));
  
  const js = jsOutput?.text || "";
  const css = cssOutput?.text || "";
  
  // 6. Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="${ctx.theme}" class="${ctx.mode}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${ctx.projectSlug} - ${ctx.frameSlug}</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${js}</script>
  </body>
</html>`;
  
  // 7. Cleanup temp dir
  await fs.rm(tempDir, { recursive: true, force: true });
  
  return { html, js, css };
}
```

**3. `studio/server/vercel/deploy.ts`** (100-150 lines)

Deploys bundle to Vercel via REST API:

```typescript
interface DeploymentFiles {
  file: string;
  data: string; // base64-encoded
}

interface DeploymentResult {
  id: string;
  url: string;
  readyState: "READY" | "ERROR" | "QUEUED";
}

export async function deployToVercel({
  name,
  files,
  token,
  team,
}: {
  name: string;
  files: DeploymentFiles[];
  token: string;
  team?: string;
}): Promise<DeploymentResult> {
  const url = team
    ? `https://api.vercel.com/v13/deployments?teamId=${team}`
    : "https://api.vercel.com/v13/deployments";
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      files,
      projectSettings: { framework: null },
      target: "production",
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vercel deploy failed: ${response.status} ${errorText}`);
  }
  
  const result = await response.json();
  return {
    id: result.id,
    url: result.url,
    readyState: result.readyState,
  };
}

export async function validateVercelToken(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.vercel.com/v2/user", {
      headers: { "Authorization": `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deleteVercelDeployment(deployId: string, token: string, team?: string): Promise<void> {
  const url = team
    ? `https://api.vercel.com/v13/deployments/${deployId}?teamId=${team}`
    : `https://api.vercel.com/v13/deployments/${deployId}`;
  
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to delete deployment: ${response.status}`);
  }
}
```

**4. `studio/server/settings.ts`** (80-120 lines)

Global settings management (Vercel token, preferences):

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { studioRoot } from "./paths";

interface Settings {
  vercel?: {
    token?: string;
    team?: string;
    projectPrefix?: string;
  };
}

const settingsPath = path.join(studioRoot(), "settings.json");

export async function getSettings(): Promise<Settings> {
  try {
    const data = await fs.readFile(settingsPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function updateSettings(partial: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(updated, null, 2));
  await fs.chmod(settingsPath, 0o600); // Owner read/write only
}

export { validateVercelToken } from "./vercel/deploy";
```

**5. `studio/server/middleware/settings.ts`** (60-100 lines)

API for reading/updating settings:

```typescript
import type { ViteDevServer } from "vite";
import { getSettings, updateSettings } from "../settings";

export function settingsMiddleware(server: ViteDevServer) {
  return async (req, res, next) => {
    // GET /api/settings
    if (req.url === "/api/settings" && req.method === "GET") {
      try {
        const settings = await getSettings();
        // Redact token (only show if present, not the value)
        const safe = {
          vercel: settings.vercel
            ? {
                hasToken: !!settings.vercel.token,
                team: settings.vercel.team,
                projectPrefix: settings.vercel.projectPrefix,
              }
            : undefined,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(safe));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    
    // PATCH /api/settings
    if (req.url === "/api/settings" && req.method === "PATCH") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const updates = JSON.parse(body);
          await updateSettings(updates);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    
    next();
  };
}
```

**6. `studio/src/components/shell/ShareButton.tsx`** (30-50 lines)

Header button component (peer of ThemeToggle, CanvasToggle):

```typescript
import { useState } from "react";
import { ShareModal } from "./ShareModal";

export function ShareButton({ projectSlug, currentFrame }: { projectSlug: string; currentFrame?: Frame }) {
  const [showModal, setShowModal] = useState(false);
  
  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        disabled={!currentFrame}
        title="Share frame"
        style={{ padding: "8px 16px" }}
      >
        Share
      </button>
      
      {showModal && currentFrame && (
        <ShareModal
          projectSlug={projectSlug}
          frame={currentFrame}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
```

**7. `studio/src/components/shell/ShareModal.tsx`** (150-250 lines)

Modal UI for sharing frames:

```typescript
import { useState } from "react";
import type { Frame } from "../../../server/types";

export function ShareModal({
  projectSlug,
  frame,
  onClose,
}: {
  projectSlug: string;
  frame: Frame;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  async function handleShare() {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/projects/${projectSlug}/frames/${frame.slug}/share`, {
        method: "POST",
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Deploy failed: ${res.status}`);
      }
      
      const data = await res.json();
      setShareUrl(data.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  
  function copyToClipboard() {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      // Show toast or temporary "Copied!" message
    }
  }
  
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface-shallow)",
          borderRadius: 12,
          padding: 24,
          width: 480,
          maxWidth: "90vw",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Share Frame</h2>
        
        <div style={{ marginBottom: 16 }}>
          <strong>{frame.name}</strong>
          <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle)", marginTop: 4 }}>
            This will deploy a standalone version to Vercel.
          </div>
        </div>
        
        {error && (
          <div
            style={{
              padding: 12,
              background: "var(--bg-error-subtle)",
              color: "var(--fg-error-default)",
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}
        
        {shareUrl ? (
          <div>
            <div
              style={{
                padding: 12,
                background: "var(--bg-success-subtle)",
                borderRadius: 8,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--fg-success-default)", marginBottom: 8 }}>
                Deployed successfully
              </div>
              <code
                style={{
                  display: "block",
                  padding: 8,
                  background: "var(--surface-backdrop)",
                  borderRadius: 4,
                  fontSize: 12,
                  wordBreak: "break-all",
                }}
              >
                {shareUrl}
              </code>
            </div>
            
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={copyToClipboard} style={{ flex: 1, padding: "8px 16px" }}>
                Copy Link
              </button>
              <button
                onClick={() => window.open(shareUrl, "_blank")}
                style={{ flex: 1, padding: "8px 16px" }}
              >
                Open
              </button>
              <button onClick={onClose} style={{ padding: "8px 16px" }}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleShare}
              disabled={loading}
              style={{
                flex: 1,
                padding: "8px 16px",
                background: "var(--bg-brand-primary)",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Deploying..." : "Deploy to Vercel"}
            </button>
            <button onClick={onClose} style={{ padding: "8px 16px" }}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

**8. `studio/src/components/shell/SettingsModal.tsx`** (120-180 lines)

Global settings modal (accessed via Settings gear in header or project picker dropdown):

```typescript
import { useState, useEffect } from "react";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState("");
  const [team, setTeam] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [saving, setSaving] = useState(false);
  
  useEffect(() => {
    async function load() {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setHasToken(data.vercel?.hasToken || false);
      setTeam(data.vercel?.team || "");
    }
    void load();
  }, []);
  
  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vercel: { token: token || undefined, team: team || undefined },
        }),
      });
      onClose();
    } catch (err) {
      alert(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }
  
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface-shallow)",
          borderRadius: 12,
          padding: 24,
          width: 520,
          maxWidth: "90vw",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 16px" }}>Studio Settings</h2>
        
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
            Vercel Access Token {hasToken && <span style={{ color: "var(--fg-success-default)" }}>(configured)</span>}
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={hasToken ? "Enter new token to update" : "vercel_abc123..."}
            style={{ width: "100%", padding: 8, borderRadius: 4 }}
          />
          <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle)", marginTop: 4 }}>
            Create a token at: https://vercel.com/account/tokens
          </div>
        </div>
        
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
            Team ID (optional)
          </label>
          <input
            type="text"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="team_abc123 (leave empty for personal)"
            style={{ width: "100%", padding: 8, borderRadius: 4 }}
          />
        </div>
        
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1,
              padding: "8px 16px",
              background: "var(--bg-brand-primary)",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={onClose} style={{ padding: "8px 16px" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Modified Files

**9. `studio/src/components/shell/StudioHeader.tsx`** (~10 line addition)

Add ShareButton to right-actions slot:

```typescript
import { ShareButton } from "./ShareButton";

// In the header's right-actions section:
<div className="header-actions">
  <ThemeToggle />
  <ShareButton projectSlug={projectSlug} currentFrame={currentFrame} />
  <CanvasToggle />
</div>
```

**10. `studio/vite.config.ts`** (~5 line addition)

Register middleware:

```typescript
import { vercelMiddleware } from "./server/middleware/vercel";
import { settingsMiddleware } from "./server/middleware/settings";

export default defineConfig({
  plugins: [
    {
      name: "arcade-studio-middleware",
      configureServer(server) {
        server.middlewares.use(settingsMiddleware(server));
        server.middlewares.use(vercelMiddleware(server));
        // ... existing middleware
      },
    },
  ],
});
```

## Implementation Phases

### Phase 1: Global Settings Infrastructure (4-5 hours)
- Create `server/settings.ts` with getSettings/updateSettings
- Create `server/middleware/settings.ts` with GET/PATCH endpoints
- Create `SettingsModal.tsx` with token input
- Settings persist to `~/Library/Application Support/arcade-studio/settings.json` with `chmod 600`
- Token validation via `GET https://api.vercel.com/v2/user`

**Verification:** Enter token in Settings → saves with correct permissions → invalid token shows error

### Phase 2: Static Bundle Builder (6-8 hours)
- Create `server/vercel/bundler.ts` with buildFrameBundle
- esbuild bundles frame + arcade components + tokens
- Generate standalone HTML with inline CSS/JS
- Stub DevRev API calls (fetch proxy intercepts `/api/devrev/*`)
- Target bundle size: <500 KB simple frames, <2 MB complex

**Verification:** Build test frame → save HTML → open in browser → renders correctly + API stubs log warnings

### Phase 3: Vercel Deploy API (4-5 hours)
- Create `server/vercel/deploy.ts` with deployToVercel, validateVercelToken
- POST to `https://api.vercel.com/v13/deployments` with bearer auth
- Save deployment records to `project.json` under `deployments[]`
- Error handling for 401, 429, network failures

**Verification:** Trigger deploy → check Vercel dashboard → visit URL → frame renders

### Phase 4: Share UI (3-4 hours)
- Create `ShareButton.tsx` in header (peer of ThemeToggle, CanvasToggle)
- Create `ShareModal.tsx` with Deploy/Copy/Open actions
- Show "DevRev API calls will return mock data" warning if frame uses DevRev helper
- Wire up POST `/api/projects/:slug/frames/:frame/share`

**Verification:** Click Share → modal opens → deploy → success screen with URL → copy/open work

## Risks & Mitigations

**Bundle size explosion:** Use esbuild tree-shaking + minification. Target <500 KB simple, <2 MB complex. Log size, warn if >1 MB.

**DevRev API stubbing breaks frames:** Show explicit warning in ShareModal: "DevRev API calls will return mock data." Future: serverless proxy with OAuth.

**Vercel rate limits (100/hour free):** Show deploy count in UI, warn at 80/hour. Future: queue locally if hit.

**Token leakage:** Always redact in logs/errors. `settings.json` in `.gitignore`. Never show token value in UI.

**Font embedding issues:** Embed fonts as data URIs or proxy through Studio server (increases bundle size but avoids CDN Referer blocks).

**Arcade import resolution:** Use esbuild `alias` config to map `arcade/*` paths. Test with frame using 10+ components.

## Future Enhancements (v1.1+)

- **Deploy History UI:** Browse past deploys, delete, re-open (data already tracked in `project.json`)
- **Multi-frame deploy:** "Deploy all frames" batch operation
- **Multi-size deploy:** Same frame at 375/1024/1440 (3 URLs or responsive toggle in deployed frame)
- **Vercel password protection:** Integrate via `vercel.json` config
- **"Made with Arcade Studio" footer:** Optional branding (default off)
- **Auto-expiry:** Delete deploys older than X days (default off)
- **Multi-platform:** Netlify, Cloudflare Pages support
- **Custom domains:** Branded URLs (requires Vercel Pro)

## Success Criteria

- [ ] Configure Vercel token in Settings modal → saves to global settings file with `chmod 600`
- [ ] Share button in header → opens ShareModal
- [ ] Deploy triggers build + Vercel API call → returns URL in 5-10s
- [ ] Deployed frame renders correctly in external browser
- [ ] DevRev API calls stubbed with warning logged
- [ ] Deploy records saved to `project.json` under `deployments[]`
- [ ] Bundle size <500 KB simple, <2 MB complex
- [ ] No token leakage in console/errors/UI
- [ ] Rate limits handled gracefully (error message if exceeded)

## Revision History

- **2026-04-24:** Resolved all open decisions. Locked approach A (static export), single-frame scope, mock DevRev data, global settings file for token storage, REST API. Updated file paths to match studio structure (`server/middleware/vercel.ts`, `server/vercel/bundler.ts`, `server/vercel/deploy.ts`, `src/components/shell/ShareButton.tsx`, `src/components/shell/ShareModal.tsx`). Removed sidebar references. Trimmed verbose sections (approach B details, CLI fallback, per-phase test cases). Deferred deploy history UI, multi-frame, multi-size, password protection to v1.1+.

## References

- Vercel API: https://vercel.com/docs/rest-api/endpoints/deployments
- esbuild: https://esbuild.github.io/api/#simple-options
- Studio architecture: `studio/ARCHITECTURE.md`
- Frame mount logic: `studio/server/plugins/frameMountPlugin.ts`
