import { describe, it, expect } from "vitest";
import { buildConfigObject } from "../../packaging/scripts/gen-telemetry-config.mjs";

describe("buildConfigObject", () => {
  it("maps env names to config keys", () => {
    expect(buildConfigObject({ SENTRY_DSN_STUDIO: "https://x@sentry.io/1", POSTHOG_KEY_STUDIO: "phc_abc", POSTHOG_HOST: "https://eu.i.posthog.com" }))
      .toEqual({ sentryDsn: "https://x@sentry.io/1", posthogKey: "phc_abc", posthogHost: "https://eu.i.posthog.com" });
  });
  it("returns empty object when no keys (build still works, telemetry silent)", () => {
    expect(buildConfigObject({})).toEqual({});
  });
});
