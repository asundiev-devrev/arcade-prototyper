import { describe, it, expect, vi, beforeEach } from "vitest";
import { initServerTelemetry } from "../../../src/lib/telemetry/server";
import { track, __resetForTest } from "../../../src/lib/telemetry/core";

describe("server telemetry shim", () => {
  beforeEach(() => __resetForTest());

  it("wires core so track routes to the debug sink when debug=true", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await initServerTelemetry({
      config: { enabled: false, debug: true, posthogHost: "h" },
      distinctId: "u1", sessionId: "s1", version: "0.30.0", os: "darwin-arm64",
    });
    track({ name: "prompt_submitted", props: { prompt_length: 3, project_slug_hash: "h", frame_count_before: 0 } });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry:server] prompt_submitted"),
      expect.objectContaining({ distinct_id: "u1" }),
    );
    spy.mockRestore();
  });
});
