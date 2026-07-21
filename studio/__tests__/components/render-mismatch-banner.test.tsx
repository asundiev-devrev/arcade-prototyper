// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RenderMismatchBanner, RENDER_MISMATCH_SENTINEL, splitRenderMismatchTrailer } from "../../src/components/chat/RenderMismatchBanner";

describe("RenderMismatchBanner", () => {
  it("has its own distinct sentinel (not VN's / not the no-frame-changes one)", () => {
    expect(RENDER_MISMATCH_SENTINEL).not.toContain("no frame changes");
    expect(RENDER_MISMATCH_SENTINEL).not.toContain("didn't move anything on screen");
    expect(RENDER_MISMATCH_SENTINEL.length).toBeGreaterThan(0);
  });
  it("splits the trailer off the body", () => {
    const { body, hasWarning } = splitRenderMismatchTrailer("Done.\n\n" + RENDER_MISMATCH_SENTINEL + " x");
    expect(hasWarning).toBe(true);
    expect(body).toBe("Done.");
  });
  it("renders the soft message", () => {
    render(<RenderMismatchBanner />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
