import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packFromSource } from "./packFromSource";
import {
  buildManifestEntries,
  renderManifestIndex,
  renderEntryDetail,
  type KitManifestEntry,
} from "../kitManifest";

const MAX_BODY = 5 * 1024 * 1024; // 5MB tsx ceiling — frames are small

// The kit manifest is the agent's API reference — every composite + template
// with props, layout, counterexamples. The Computer agent runs in devrev-web
// and can't read this repo's filesystem, so the sidecar serves it.
//
// Served as two tiers because the full manifest (~62KB) exceeds the Claude
// Agent SDK's ~50KB tool-output cap — over that, the agent only sees a 2KB
// preview and goes blind to the kit. `/manifest` returns a slim index that
// fits in one fetch; `/manifest/<Name>` returns one entry's full detail.
const SIDECAR_DIR = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.join(SIDECAR_DIR, "..", "..", "prototype-kit");

// Built once on first manifest request, then cached for the sidecar's life.
let entriesCache: Promise<KitManifestEntry[]> | null = null;
function getEntries(): Promise<KitManifestEntry[]> {
  if (!entriesCache) entriesCache = buildManifestEntries(KIT_ROOT);
  return entriesCache;
}

// Localhost-only HTTP service. POST /pack { tsx, mode?, theme? } -> { html }.
// GET /manifest -> KIT-MANIFEST.md (text). Bound to 127.0.0.1 by the caller;
// never exposed off-host.
export function createSidecarServer(): http.Server {
  return http.createServer((req, res) => {
    const send = (status: number, obj: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    const sendMd = (md: string) => {
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(md);
    };

    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });

    // Slim catalog — fits the agent runtime's tool-output cap in one fetch.
    if (req.method === "GET" && req.url === "/manifest") {
      getEntries()
        .then((entries) => sendMd(renderManifestIndex(entries)))
        .catch((err) =>
          send(500, { error: "manifest_unavailable", message: err?.message ?? String(err) }),
        );
      return;
    }

    // Per-entry detail — full diagram, props, counterexamples for one name.
    const detailMatch = req.method === "GET" && req.url?.match(/^\/manifest\/([A-Za-z][A-Za-z0-9]*)$/);
    if (detailMatch) {
      const name = detailMatch[1];
      getEntries()
        .then((entries) => {
          const entry = entries.find((e) => e.name === name);
          if (!entry) return send(404, { error: "unknown_component", name });
          sendMd(renderEntryDetail(entry));
        })
        .catch((err) =>
          send(500, { error: "manifest_unavailable", message: err?.message ?? String(err) }),
        );
      return;
    }

    if (req.method !== "POST" || req.url !== "/pack") return send(404, { error: "not_found" });

    let body = "";
    let tooBig = false;
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (tooBig) return send(413, { error: "payload_too_large" });
      let parsed: { tsx?: string; mode?: "light" | "dark"; theme?: "arcade" | "devrev-app" };
      try {
        parsed = JSON.parse(body);
      } catch {
        return send(400, { error: "invalid_json" });
      }
      if (!parsed.tsx || typeof parsed.tsx !== "string") {
        return send(400, { error: "missing_tsx" });
      }
      try {
        const html = await packFromSource({
          tsx: parsed.tsx,
          mode: parsed.mode,
          theme: parsed.theme,
        });
        return send(200, { html });
      } catch (err: any) {
        return send(500, { error: "pack_failed", message: err?.message ?? String(err) });
      }
    });
  });
}
