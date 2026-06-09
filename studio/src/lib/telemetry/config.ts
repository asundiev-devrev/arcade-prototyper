export interface TelemetryFileConfig { sentryDsn?: string; posthogKey?: string; posthogHost?: string }

export interface ResolvedTelemetryConfig {
  sentryDsn?: string;
  posthogKey?: string;
  posthogHost: string;
  /** True only when packaged AND both keys present — actually sends. */
  enabled: boolean;
  /** True when ARCADE_TELEMETRY_DEBUG is set — prints to console sink. */
  debug: boolean;
}

const DEFAULT_HOST = "https://us.i.posthog.com";

export function resolveConfig(input: { packaged: boolean; debugEnv: string | undefined; fileConfig: TelemetryFileConfig }): ResolvedTelemetryConfig {
  const { packaged, debugEnv, fileConfig } = input;
  // Enable if AT LEAST ONE key is present — Sentry and PostHog ship
  // independently (e.g. PostHog-first, Sentry added later). Each SDK only
  // actually inits when ITS own key exists (see server.ts / renderer.ts /
  // electron/telemetry.ts), so a blank half stays dormant, not broken.
  const hasKeys = Boolean(fileConfig.sentryDsn || fileConfig.posthogKey);
  return {
    sentryDsn: fileConfig.sentryDsn,
    posthogKey: fileConfig.posthogKey,
    posthogHost: fileConfig.posthogHost ?? DEFAULT_HOST,
    enabled: packaged && hasKeys,
    debug: Boolean(debugEnv),
  };
}

/** Read telemetry.config.json from a resources dir. {} on any failure. Node-only. */
export async function readFileConfig(resourcesPath: string | undefined): Promise<TelemetryFileConfig> {
  if (!resourcesPath) return {};
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    return JSON.parse(await fs.readFile(path.join(resourcesPath, "telemetry.config.json"), "utf-8"));
  } catch {
    return {};
  }
}
