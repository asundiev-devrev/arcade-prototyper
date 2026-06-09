import { describe, it, expect } from "vitest";
import { EVENT_NAMES, type TelemetryEvent } from "../../../src/lib/telemetry/events";

describe("telemetry events catalog", () => {
  it("exposes every event name as a const tuple, no duplicates", () => {
    expect(EVENT_NAMES).toContain("app_launched");
    expect(EVENT_NAMES).toContain("frame_generated");
    expect(EVENT_NAMES).toContain("frame_runtime_error");
    expect(EVENT_NAMES).toContain("share_succeeded");
    expect(EVENT_NAMES).toContain("settings_opened");
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  it("types a payload to its event via discriminated union", () => {
    const e: TelemetryEvent = {
      name: "frame_generated",
      props: { project_slug_hash: "abc", duration_ms: 1200, model: "sonnet", tokens_input: 10, tokens_output: 20, turn_type: "build" },
    };
    expect(e.props.turn_type).toBe("build");
  });
});
