import type { IncomingMessage, ServerResponse } from "node:http";
import { getDevRevPat } from "../secrets/keychain";

const MAX_RETRIES = 5;
const RETRYABLE_STATUSES = new Set([425, 429, 503]);

/**
 * DevRev API proxy middleware.
 * Forwards requests from /api/devrev/* to api.devrev.ai with retry logic.
 * Reads PAT from the global keychain entry; falls back to DEVREV_PAT env var.
 * Frames never need to include the PAT in their fetch calls.
 */
export function devrevMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";

    // Only handle /api/devrev/* routes
    if (!url.startsWith("/api/devrev/")) return next?.();

    // Extract endpoint: /api/devrev/works.list → /works.list
    const endpoint = url.replace(/^\/api\/devrev/, "") || "/";

    const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";

    if (!pat) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No PAT configured" }));
      return;
    }

    // Read request body
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    // Retry loop with exponential backoff
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      lastResponse = await fetch(`https://api.devrev.ai${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: pat,
        },
        body: body || undefined,
      });

      // Break if not retryable
      if (!RETRYABLE_STATUSES.has(lastResponse.status)) {
        break;
      }

      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      const delay = Math.pow(2, attempt + 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (!lastResponse) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No response from DevRev API" }));
      return;
    }

    // Forward response
    const responseBody = await lastResponse.text();
    res.writeHead(lastResponse.status, {
      "Content-Type": "application/json",
    });
    res.end(responseBody);
  };
}
