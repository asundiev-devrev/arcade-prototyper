// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisualNoOpBanner, splitVisualNoOpTrailer, VISUAL_NOOP_SENTINEL } from "../../src/components/chat/VisualNoOpBanner";

describe("VisualNoOpBanner", () => {
  it("has a distinct sentinel (not the no-frame-changes one)", () => {
    expect(VISUAL_NOOP_SENTINEL).not.toContain("no frame changes");
    expect(VISUAL_NOOP_SENTINEL.length).toBeGreaterThan(0);
  });
  it("splits the trailer off the body", () => {
    const { body, hasWarning } = splitVisualNoOpTrailer("Done.\n\n" + VISUAL_NOOP_SENTINEL + " rest");
    expect(hasWarning).toBe(true);
    expect(body).toBe("Done.");
  });
  it("no sentinel → no warning, body intact", () => {
    const { body, hasWarning } = splitVisualNoOpTrailer("All good.");
    expect(hasWarning).toBe(false);
    expect(body).toBe("All good.");
  });
  it("renders the soft message", () => {
    render(<VisualNoOpBanner />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
