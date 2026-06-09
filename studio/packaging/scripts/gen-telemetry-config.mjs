import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Pure: map raw env to the telemetry.config.json shape. Only emits present keys
 *  so a missing key → silent telemetry. */
export function buildConfigObject(env) {
  const out = {};
  if (env.SENTRY_DSN_STUDIO) out.sentryDsn = env.SENTRY_DSN_STUDIO;
  if (env.POSTHOG_KEY_STUDIO) out.posthogKey = env.POSTHOG_KEY_STUDIO;
  if (env.POSTHOG_HOST) out.posthogHost = env.POSTHOG_HOST;
  return out;
}

function parseDotenv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..", "..", "..");
  const envPath = join(repoRoot, ".env.production");
  const fileEnv = existsSync(envPath) ? parseDotenv(readFileSync(envPath, "utf-8")) : {};
  const config = buildConfigObject({ ...fileEnv, ...process.env });
  const outPath = join(here, "..", "telemetry.config.json");
  writeFileSync(outPath, JSON.stringify(config, null, 2));
  console.log(`[gen-telemetry-config] wrote ${outPath} (${Object.keys(config).length} keys)`);
}
