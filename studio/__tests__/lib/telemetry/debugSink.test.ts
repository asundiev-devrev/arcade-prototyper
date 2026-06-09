import { describe, it, expect, vi } from "vitest";
import { debugTrack, debugError } from "../../../src/lib/telemetry/debugSink";

describe("debugSink", () => {
  it("prints event name + props with a stable prefix", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    debugTrack("renderer", { name: "settings_opened", props: { tab: "general" } }, "user-1");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry:renderer] settings_opened"),
      expect.objectContaining({ tab: "general", distinct_id: "user-1" }),
    );
    spy.mockRestore();
  });
  it("prints errors with process tag", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugError("server", new Error("boom"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[telemetry:server] error"), expect.any(Error));
    spy.mockRestore();
  });
});
