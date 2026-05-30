import http from "node:http";
import { packFromSource } from "./packFromSource";

const MAX_BODY = 5 * 1024 * 1024; // 5MB tsx ceiling — frames are small

// Localhost-only HTTP service. POST /pack { tsx, mode?, theme? } -> { html }.
// Bound to 127.0.0.1 by the caller; never exposed off-host.
export function createSidecarServer(): http.Server {
  return http.createServer((req, res) => {
    const send = (status: number, obj: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
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
