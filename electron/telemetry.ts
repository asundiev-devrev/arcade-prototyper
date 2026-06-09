import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface FileConfig { sentryDsn?: string; posthogKey?: string; posthogHost?: string }

function readConfig(): FileConfig {
  try { return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "telemetry.config.json"), "utf-8")); }
  catch { return {}; }
}

/**
 * Read the distinct_id the Vite-child server already resolved + persisted
 * (DevRev email, or an anon uuid). The main process can't import the server's
 * settings module, so replicate the path logic from server/paths.ts:studioRoot.
 * Returns "anonymous" if settings.json has no telemetry block yet (first launch
 * before the server has written it) — the server's events still carry the email.
 */
function readPersistedDistinctId(): string {
  try {
    const root = process.env.ARCADE_STUDIO_ROOT
      || path.join(os.homedir(), "Library", "Application Support", "arcade-studio");
    const raw = fs.readFileSync(path.join(root, "settings.json"), "utf-8");
    const id = JSON.parse(raw)?.telemetry?.distinctId;
    return typeof id === "string" && id ? id : "anonymous";
  } catch {
    return "anonymous";
  }
}

let posthog: any = null;
let sessionStart = 0;
let sessionId = "";
let distinctId = "anonymous";
let enabled = false;
let debug = false;
const DEFAULT_HOST = "https://us.i.posthog.com";

function mainBeforeSend(event: any): any {
  try {
    if (Array.isArray(event?.breadcrumbs)) {
      for (const b of event.breadcrumbs) {
        if (typeof b?.data?.url === "string") b.data.url = b.data.url.replace(/\/api\/projects\/[^/]+/g, "/api/projects/<slug>");
      }
    }
    if (event?.extra && typeof event.extra === "object" && "prompt" in event.extra) event.extra.prompt = "[redacted]";
  } catch {}
  return event;
}

export async function initMainTelemetry(): Promise<void> {
  const cfg = readConfig();
  debug = Boolean(process.env.ARCADE_TELEMETRY_DEBUG);
  // At least one key — Sentry + PostHog ship independently; each inits only
  // when its own key is present below.
  enabled = app.isPackaged && Boolean(cfg.sentryDsn || cfg.posthogKey);
  sessionStart = Date.now();
  sessionId = randomUUID();
  distinctId = readPersistedDistinctId();

  if (enabled && cfg.sentryDsn) {
    try {
      const Sentry = await import("@sentry/electron/main");
      Sentry.init({ dsn: cfg.sentryDsn, release: `arcade-studio@${app.getVersion()}`, beforeSend: mainBeforeSend });
    } catch (err) { console.error("[telemetry] main sentry init failed:", err); }
  }
  if (enabled && cfg.posthogKey) {
    try {
      const { PostHog } = await import("posthog-node");
      posthog = new PostHog(cfg.posthogKey, { host: cfg.posthogHost ?? DEFAULT_HOST });
    } catch (err) { console.error("[telemetry] main posthog init failed:", err); }
  }
}

function emit(event: string, props: Record<string, unknown>): void {
  const full = { ...props, distinct_id: distinctId, process: "main", version: app.getVersion(), session_id: sessionId, os: `${process.platform}-${process.arch}` };
  if (enabled && posthog) {
    try { posthog.capture({ distinctId, event, properties: full }); } catch {}
    // One line per sent event so the packaged-app file log proves what fired
    // (capture() is otherwise silent in production). Just the name + who —
    // no payload, keeps the log readable + leaks nothing extra.
    console.log(`[telemetry] sent ${event} (${distinctId})`);
  } else if (debug) {
    console.log(`[telemetry:main] ${event}`, full);
  }
}

export function emitAppLaunched(isFirstLaunch: boolean): void {
  emit("app_launched", {
    version: app.getVersion(),
    os: `${process.platform}-${process.arch}`,
    os_version: process.getSystemVersion?.() ?? "",
    is_first_launch: isFirstLaunch,
  });
}

export async function emitAppShutdown(): Promise<void> {
  emit("app_shutdown", { session_duration_ms: Date.now() - sessionStart });
  try { await posthog?.shutdown?.(); } catch {}
}
