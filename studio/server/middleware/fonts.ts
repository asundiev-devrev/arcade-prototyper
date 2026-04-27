import type { IncomingMessage, ServerResponse } from "node:http";

const CDN_ORIGIN = "https://files.dev.devrev-eng.ai";
const ALLOWED = new Set([
  "ChipDispVar.woff2",
  "ChipTextVar.woff2",
  "ChipMono-Regular.woff2",
  "ChipMono-Medium.woff2",
]);

export function fontsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/fonts/")) return next?.();
    if (req.method !== "GET" && req.method !== "HEAD") return next?.();

    const name = url.slice("/api/fonts/".length).split("?")[0];
    if (!ALLOWED.has(name)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Unknown font");
      return;
    }

    try {
      // Fetch without Referer — the CDN whitelists Referer, and localhost
      // isn't on the list. Node's fetch omits Referer by default.
      const upstream = await fetch(`${CDN_ORIGIN}/fonts/${name}`);
      if (!upstream.ok || !upstream.body) {
        res.writeHead(upstream.status, { "Content-Type": "text/plain" });
        res.end(`Upstream ${upstream.status}`);
        return;
      }
      res.writeHead(200, {
        "Content-Type": upstream.headers.get("content-type") ?? "font/woff2",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    } catch (err: any) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Font proxy error: ${err?.message ?? err}`);
    }
  };
}
