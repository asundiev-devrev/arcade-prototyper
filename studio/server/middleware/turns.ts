import type { IncomingMessage, ServerResponse } from "node:http";
import { hasActiveTurn } from "../turnRegistry";

/**
 * GET /api/turns/active → { active: boolean }
 *
 * Read-only view of whether ANY generation turn is currently running. The
 * Electron auto-updater (a separate process with no IPC channel to this
 * server) polls this before applying a downloaded update, so it can defer the
 * required restart until the user's work is done. Intentionally tiny and
 * unauthenticated — it leaks no data, just a boolean, on localhost.
 */
export function turnsMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.method === "GET" && (req.url === "/api/turns/active" || req.url?.startsWith("/api/turns/active?"))) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: hasActiveTurn() }));
      return;
    }
    return next?.();
  };
}
