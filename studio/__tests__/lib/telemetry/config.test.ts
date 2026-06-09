import { describe, it, expect } from "vitest";
import { resolveConfig } from "../../../src/lib/telemetry/config";

describe("resolveConfig", () => {
  it("disabled when not packaged, even with keys", () => {
    const c = resolveConfig({ packaged: false, debugEnv: undefined, fileConfig: { sentryDsn: "d", posthogKey: "k" } });
    expect(c.enabled).toBe(false);
    expect(c.debug).toBe(false);
  });
  it("enabled when packaged + keys present", () => {
    const c = resolveConfig({ packaged: true, debugEnv: undefined, fileConfig: { sentryDsn: "d", posthogKey: "k", posthogHost: "https://us.i.posthog.com" } });
    expect(c.enabled).toBe(true);
    expect(c.posthogHost).toBe("https://us.i.posthog.com");
  });
  it("enabled with only PostHog key (Sentry added later)", () => {
    const c = resolveConfig({ packaged: true, debugEnv: undefined, fileConfig: { posthogKey: "phc_x", posthogHost: "https://eu.i.posthog.com" } });
    expect(c.enabled).toBe(true);
    expect(c.sentryDsn).toBeUndefined();
  });
  it("enabled with only Sentry DSN (no PostHog)", () => {
    expect(resolveConfig({ packaged: true, debugEnv: undefined, fileConfig: { sentryDsn: "d" } }).enabled).toBe(true);
  });
  it("packaged but no keys → disabled (silent)", () => {
    expect(resolveConfig({ packaged: true, debugEnv: undefined, fileConfig: {} }).enabled).toBe(false);
  });
  it("debug env forces debug sink, never real send", () => {
    const c = resolveConfig({ packaged: false, debugEnv: "1", fileConfig: {} });
    expect(c.debug).toBe(true);
    expect(c.enabled).toBe(false);
  });
});
