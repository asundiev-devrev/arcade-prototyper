import type { IncomingMessage, ServerResponse } from "node:http";
import { setPending, requestInstall, clearPending, getUpdateState } from "../updateRegistry";

/** Read and JSON-parse a request body; {} on empty/invalid. */
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(Buffer.from(c)));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(parts).toString() || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

/**
 * Update-status blackboard endpoints. Localhost, unauthenticated, tiny — same
 * posture as turnsMiddleware. Bridges the no-IPC gap between Electron main (the
 * updater) and the React shell. See updateRegistry.ts.
 */
export function updateMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = (req.url ?? "").split("?")[0];

    if (req.method === "GET" && url === "/api/update/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getUpdateState()));
      return;
    }
    if (req.method === "POST" && url === "/api/update/available") {
      const body = await readJson(req);
      if (typeof body.version === "string" && body.version.length > 0) {
        setPending(body.version);
      }
      res.writeHead(204); res.end();
      return;
    }
    if (req.method === "POST" && url === "/api/update/install") {
      requestInstall();
      res.writeHead(204); res.end();
      return;
    }
    if (req.method === "POST" && url === "/api/update/clear") {
      clearPending();
      res.writeHead(204); res.end();
      return;
    }
    return next?.();
  };
}
