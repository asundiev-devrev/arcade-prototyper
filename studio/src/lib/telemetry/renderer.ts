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
      sentry.init({ dsn: args.config.sentryDsn, release: `arcade-studio@${args.version}` });
      sentry.setTag("process", "renderer");
    }
    if (args.config.enabled && args.config.posthogKey) {
      const mod = await import("posthog-js");
      posthog = mod.default ?? mod;
      posthog.init(args.config.posthogKey, { api_host: args.config.posthogHost, autocapture: false, capture_pageview: false, disable_session_recording: true });
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
