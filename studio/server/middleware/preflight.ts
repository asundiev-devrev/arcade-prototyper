import type { IncomingMessage, ServerResponse } from "node:http";
import { ensureDeps } from "../firstRun";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function preflightMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/preflight")) return next?.();
    if (req.method !== "GET") return next?.();
    try {
      send(res, 200, await ensureDeps());
    } catch (err: any) {
      send(res, 500, { error: { code: "preflight_failed", message: err?.message ?? "preflight failed" } });
    }
  };
}
