// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Mock @xorkavi/arcade-gen — same pattern as viewport-live-cursor.test.tsx.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  return {
    IconButton: passthrough("button"),
    ArrowUpRightSmall: () => null,
    Tooltip: ({ children }: any) => React.createElement("div", null, children),
    useToast: () => ({ toast: () => {} }),
  };
});

vi.mock("../../src/hooks/targetSelectionContext", () => ({
  useTargetSelection: () => ({
    target: null,
    setTarget: () => {},
  }),
}));

import { FrameCard } from "../../src/components/viewport/FrameCard";
import type { Frame } from "../../server/types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const demoFrame: Frame = {
  slug: "home",
  name: "Home",
  size: "1440",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("FrameCard skeleton integration", () => {
  it("renders FrameSkeleton when phase=running and agentCursor.frame matches", () => {
    const { container } = render(
      <FrameCard
        projectSlug="demo"
        frame={demoFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        projectMode="light"
        zoom={1}
        phase="running"
        agentCursor={{
          frame: "home",
          action: "writing",
          composites: ["Hero", "Button"],
          updatedAt: Date.now(),
        }}
      />,
    );
    expect(container.querySelector('[data-testid="frame-skeleton"]')).not.toBeNull();
  });

  it("does NOT render FrameSkeleton when phase=idle", () => {
    const { container } = render(
      <FrameCard
        projectSlug="demo"
        frame={demoFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        projectMode="light"
        zoom={1}
        phase="idle"
        agentCursor={{
          frame: "home",
          action: "writing",
          composites: ["Hero"],
          updatedAt: Date.now(),
        }}
      />,
    );
    expect(container.querySelector('[data-testid="frame-skeleton"]')).toBeNull();
  });

  it("does NOT render FrameSkeleton when agentCursor.frame does NOT match", () => {
    const { container } = render(
      <FrameCard
        projectSlug="demo"
        frame={demoFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        projectMode="light"
        zoom={1}
        phase="running"
        agentCursor={{
          frame: "details",
          action: "writing",
          composites: [],
          updatedAt: Date.now(),
        }}
      />,
    );
    expect(container.querySelector('[data-testid="frame-skeleton"]')).toBeNull();
  });

  it("defaults phase to idle and agentCursor to null when not passed", () => {
    const { container } = render(
      <FrameCard
        projectSlug="demo"
        frame={demoFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        projectMode="light"
        zoom={1}
      />,
    );
    // No skeleton rendered
    expect(container.querySelector('[data-testid="frame-skeleton"]')).toBeNull();
  });
});
