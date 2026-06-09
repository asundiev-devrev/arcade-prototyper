import { describe, it, expect, vi, beforeEach } from "vitest";
import { initCore, track, captureError, __resetForTest } from "../../../src/lib/telemetry/core";

const base = { proc: "server" as const, distinctId: "u1", sessionId: "s1", version: "0.30.0", os: "darwin-arm64" };

describe("core telemetry routing", () => {
  beforeEach(() => __resetForTest());

  it("track is a no-op before init", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    track({ name: "settings_opened", props: { tab: "x" } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("routes to debug sink when debug=true, enabled=false", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    initCore({ ...base, enabled: false, debug: true, adapter: null });
    track({ name: "frame_generated", props: { project_slug_hash: "h", turn_type: "build" } });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry:server] frame_generated"),
      expect.objectContaining({ distinct_id: "u1", session_id: "s1", version: "0.30.0" }),
    );
    spy.mockRestore();
  });

  it("routes to adapter when enabled, with super-props merged", () => {
    const captured: any[] = [];
    initCore({ ...base, enabled: true, debug: false, adapter: {
      capture: (name, distinctId, props) => captured.push({ name, distinctId, props }),
      captureException: () => {},
    }});
    track({ name: "settings_opened", props: { tab: "general" } });
    expect(captured[0].name).toBe("settings_opened");
    expect(captured[0].props).toMatchObject({ tab: "general", process: "server", session_id: "s1" });
  });

  it("captureError routes to adapter.captureException when enabled", () => {
    let caught: unknown = null;
    initCore({ ...base, enabled: true, debug: false, adapter: {
      capture: () => {}, captureException: (e) => { caught = e; },
    }});
    const err = new Error("x");
    captureError(err);
    expect(caught).toBe(err);
  });
});
