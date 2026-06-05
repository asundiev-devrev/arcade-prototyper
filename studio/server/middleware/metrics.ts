import type { IncomingMessage, ServerResponse } from "node:http";
import { summarizeMetrics } from "../metrics";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

/**
 * GET /api/metrics[?sinceDays=N] — aggregate generation telemetry.
 *
 * Returns latency percentiles (duration + ttft), the edit-vs-build ratio,
 * cross-turn cache-hit rate, stall rate, model mix, and median frame size —
 * the data the team has been ESTIMATING all session. Optional `sinceDays`
 * windows the rows (default: all of history).
 */
export function metricsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/metrics")) return next?.();
    if (req.method !== "GET") return next?.();
    try {
      const q = new URL(url, "http://localhost").searchParams;
      const sinceDays = Number(q.get("sinceDays"));
      const sinceMs =
        Number.isFinite(sinceDays) && sinceDays > 0
          ? Date.now() - sinceDays * 24 * 60 * 60 * 1000
          : undefined;
      send(res, 200, await summarizeMetrics(sinceMs));
    } catch (err: any) {
      send(res, 500, { error: { code: "metrics_failed", message: err?.message ?? "metrics failed" } });
    }
  };
}
