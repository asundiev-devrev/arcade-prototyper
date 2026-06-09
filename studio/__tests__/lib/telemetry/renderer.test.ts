import { describe, it, expect, vi, beforeEach } from "vitest";
import { initRendererTelemetry } from "../../../src/lib/telemetry/renderer";
import { track, __resetForTest } from "../../../src/lib/telemetry/core";

describe("renderer telemetry shim", () => {
  beforeEach(() => __resetForTest());
  it("wires core so track routes to debug sink when debug=true", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await initRendererTelemetry({
      config: { enabled: false, debug: true, posthogHost: "h" },
      distinctId: "u1", sessionId: "s1", version: "0.30.0", os: "darwin-arm64",
    });
    track({ name: "settings_opened", props: { tab: "general" } });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry:renderer] settings_opened"),
      expect.objectContaining({ tab: "general", distinct_id: "u1" }),
    );
    spy.mockRestore();
  });
});
