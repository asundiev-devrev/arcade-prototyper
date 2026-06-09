import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRuntimeError } from "../buildErrorReporter";
import { track, captureError } from "../../src/lib/telemetry/server";
import { hashSlug, truncate, stripPaths } from "../../src/lib/telemetry/redact";
import type { FrameErrorKind } from "../../src/lib/telemetry/events";

export function classifyFrameError(message: string): FrameErrorKind {
  if (/does not provide an export|Failed to (resolve|fetch|load).*module|Cannot find module/i.test(message)) return "module_not_found";
  if (/SyntaxError|Unexpected token/i.test(message)) return "syntax_error";
  if (/\[hmr\]|hot update|hmr/i.test(message)) return "hmr_failure";
  return "runtime_exception";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  if (!buf) return {};
  try {
    return JSON.parse(buf);
  } catch {
    return {};
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/**
 * POST /api/runtime-error — receives frame runtime errors from
 * FrameErrorBoundary via postMessage → fetch, and dispatches an
 * auto-fix claude turn (rate-limited per frame).
 */
export function runtimeErrorMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.url !== "/api/runtime-error" || req.method !== "POST") return next?.();

    const body = (await readJson(req)) as {
      slug?: unknown;
      frame?: unknown;
      message?: unknown;
    };

    const slug = typeof body.slug === "string" ? body.slug : "";
    const frame = typeof body.frame === "string" ? body.frame : "";
    const message = typeof body.message === "string" ? body.message : "";

    if (!slug || !frame) {
      return send(res, 400, {
        error: { code: "bad_request", message: "slug and frame are required" },
      });
    }

    const kind = classifyFrameError(message);
    track({
      name: "frame_runtime_error",
      props: {
        project_slug_hash: hashSlug(slug),
        error_kind: kind,
        error_message: truncate(stripPaths(message), 200),
        frame_hash: hashSlug(frame),
      },
    });
    captureError(new Error(`frame_runtime_error: ${kind}`));

    // Fire-and-forget: never block on the auto-fix turn.
    void handleRuntimeError(slug, frame, message).catch((err) => {
      console.warn("[runtimeError] handleRuntimeError threw:", err);
    });

    send(res, 202, { status: "dispatched" });
  };
}
