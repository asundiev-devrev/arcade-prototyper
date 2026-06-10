import type { ResolvedTelemetryConfig } from "./config";
import { initCore, type SendAdapter } from "./core";

export { track, captureError } from "./core";

interface InitArgs {
  config: Pick<ResolvedTelemetryConfig, "enabled" | "debug" | "posthogHost"> & { sentryDsn?: string; posthogKey?: string };
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
}

/** Browser-safe Sentry scrub: strip raw project slugs from breadcrumb URLs +
 *  prompt-bearing extras. Mirrors redact.sentryBeforeSend but without the
 *  node:crypto import that would break the browser bundle. */
function rendererBeforeSend(event: any): any {
  try {
    if (Array.isArray(event?.breadcrumbs)) {
      for (const b of event.breadcrumbs) {
        if (typeof b?.data?.url === "string") {
          b.data.url = b.data.url.replace(/\/api\/projects\/[^/]+/g, "/api/projects/<slug>");
        }
      }
    }
    if (event?.extra && typeof event.extra === "object" && "prompt" in event.extra) {
      event.extra.prompt = "[redacted]";
    }
    const headers = event?.request?.headers;
    if (headers && typeof headers === "object") {
      for (const k of Object.keys(headers)) if (/^authorization$/i.test(k)) headers[k] = "[redacted]";
    }
  } catch {}
  return event;
}

/**
 * Renderer-side telemetry init. Mirrors server.ts but routes through the
 * browser SDKs (posthog-js / @sentry/browser). Call sites import the shared
 * `track` re-exported above; it no-ops until this runs, so importing it from a
 * component is always safe.
 */
export async function initRendererTelemetry(args: InitArgs): Promise<void> {
  let adapter: SendAdapter | null = null;
  let sentry: any = null;
  let posthog: any = null;
  try {
    if (args.config.enabled && args.config.sentryDsn) {
      sentry = await import("@sentry/browser");
      sentry.init({ dsn: args.config.sentryDsn, release: `arcade-studio@${args.version}`, beforeSend: rendererBeforeSend });
      sentry.setTag("process", "renderer");
    }
    if (args.config.enabled && args.config.posthogKey) {
      const mod = await import("posthog-js");
      posthog = mod.default ?? mod;
      posthog.init(args.config.posthogKey, {
        api_host: args.config.posthogHost,
        // bootstrap distinctID = the DevRev email so posthog-js NEVER mints an
        // anonymous UUID. Without this, posthog-js generates a random id, fires
        // events under it, and identify() later merges anon→email — leaving the
        // person LABELLED by the ugly UUID in the Activity view. Bootstrapping
        // makes the email the distinct_id from event #1; matches posthog-node
        // (server/main also use the email), so one person, labelled by email.
        bootstrap: { distinctID: args.distinctId },
        autocapture: false,
        capture_pageview: false,
        // posthog-js auto-captures Web Vitals / performance under its own flag
        // (NOT autocapture) — that's the "Web vitals" noise in the feed. Off:
        // we only want our explicit events.
        capture_performance: false,
        disable_session_recording: true,
      });
      posthog.identify(args.distinctId);
    }
    if (args.config.enabled) {
      adapter = {
        capture: (name, _distinctId, props) => posthog?.capture(name, props),
        captureException: (err) => sentry?.captureException(err),
      };
    }
  } catch (err) {
    console.warn("[telemetry] renderer init failed:", err instanceof Error ? err.message : err);
  }
  initCore({ proc: "renderer", enabled: args.config.enabled, debug: args.config.debug, distinctId: args.distinctId, sessionId: args.sessionId, version: args.version, os: args.os, adapter });
}
