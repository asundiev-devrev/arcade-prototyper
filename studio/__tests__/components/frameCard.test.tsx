// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

// Mock @xorkavi/arcade-gen — same pattern as viewport-partials.test.tsx.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  return {
    IconButton: passthrough("button"),
    ArrowUpRightSmall: () => null,
    TrashBin: () => null,
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

describe("FrameCard wipe animation", () => {
  it("adds wipe class on iframe load while turn is running", () => {
    const { container } = render(
      <FrameCard
        projectSlug="demo"
        frame={demoFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        projectMode="light"
        zoom={1}
        phase="running"
      />,
    );
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe);
    const wrapper = iframe.parentElement!;
    expect(wrapper.classList.contains("arcade-studio-frame-wipe")).toBe(true);
  });

  it("does NOT add wipe class on iframe load when phase is not running", () => {
    const { container } = render(
      <FrameCard
        projectSlug="demo"
        frame={demoFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        projectMode="light"
        zoom={1}
        phase="idle"
      />,
    );
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe);
    const wrapper = iframe.parentElement!;
    expect(wrapper.classList.contains("arcade-studio-frame-wipe")).toBe(false);
  });

  it("removes wipe class on animationend", () => {
    const { container } = render(
      <FrameCard
        projectSlug="demo"
        frame={demoFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        projectMode="light"
        zoom={1}
        phase="running"
      />,
    );
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe);
    const wrapper = iframe.parentElement!;
    fireEvent.animationEnd(wrapper);
    expect(wrapper.classList.contains("arcade-studio-frame-wipe")).toBe(false);
  });
});
