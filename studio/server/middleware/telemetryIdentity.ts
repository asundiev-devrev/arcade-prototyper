import type { IncomingMessage, ServerResponse } from "node:http";

export interface IdentitySnapshot {
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
  config: { enabled: boolean; debug: boolean; posthogHost: string; posthogKey?: string; sentryDsn?: string };
}

let snapshot: IdentitySnapshot | null = null;

/** Called once at server boot after identity is resolved. */
export function setIdentitySnapshot(s: IdentitySnapshot): void { snapshot = s; }
/** Test seam. */
export function __setIdentitySnapshot(s: IdentitySnapshot): void { snapshot = s; }

export function telemetryIdentityMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.url !== "/api/telemetry/identity" || req.method !== "GET") return next?.();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(snapshot ?? { distinctId: "", sessionId: "", version: "", os: "", config: { enabled: false, debug: false, posthogHost: "" } }));
  };
}
