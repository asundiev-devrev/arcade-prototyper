import type { ResolvedTelemetryConfig } from "./config";
import { sentryBeforeSend } from "./redact";
import { initCore, type SendAdapter } from "./core";

export { track, captureError } from "./core";

interface InitArgs {
  config: Pick<ResolvedTelemetryConfig, "enabled" | "debug" | "posthogHost"> & { sentryDsn?: string; posthogKey?: string };
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
}

let posthogRef: any = null;

export async function initServerTelemetry(args: InitArgs): Promise<void> {
  let adapter: SendAdapter | null = null;
  let sentry: any = null;
  let posthog: any = null;
  try {
    if (args.config.enabled && args.config.sentryDsn) {
      sentry = await import("@sentry/node");
      sentry.init({ dsn: args.config.sentryDsn, release: `arcade-studio@${args.version}`, beforeSend: (e: any) => sentryBeforeSend(e) });
      sentry.setTag("process", "server");
    }
    if (args.config.enabled && args.config.posthogKey) {
      const { PostHog } = await import("posthog-node");
      posthog = new PostHog(args.config.posthogKey, { host: args.config.posthogHost });
    }
    if (args.config.enabled) {
      adapter = {
        capture: (name, distinctId, props) => posthog?.capture({ distinctId, event: name, properties: props }),
        captureException: (err) => sentry?.captureException(err),
      };
    }
  } catch (err) {
    console.warn("[telemetry] server init failed:", err instanceof Error ? err.message : err);
  }
  posthogRef = posthog;
  initCore({ proc: "server", enabled: args.config.enabled, debug: args.config.debug, distinctId: args.distinctId, sessionId: args.sessionId, version: args.version, os: args.os, adapter });
}

export async function shutdownServerTelemetry(): Promise<void> {
  try { await posthogRef?.shutdown?.(); } catch {}
}
