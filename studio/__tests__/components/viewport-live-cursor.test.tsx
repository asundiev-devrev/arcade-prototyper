// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Project } from "../../server/types";

// Mock @xorkavi/arcade-gen — same shim as sibling tests.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  const Menu: any = ({ children }: any) => React.createElement("div", null, children);
  Menu.Root = ({ children }: any) => React.createElement("div", null, children);
  Menu.Trigger = React.forwardRef(({ children, asChild, ...rest }: any, ref: any) =>
    asChild ? React.cloneElement(children, { ...rest, ref }) : React.createElement("button", { ...rest, ref }, children)
  );
  Menu.Content = ({ children }: any) => React.createElement("div", null, children);
  Menu.Item = ({ children, ...rest }: any) => React.createElement("div", rest, children);
  return {
    IconButton: passthrough("button"),
    ArrowUpRightSmall: () => null,
    ChevronDownSmall: () => null,
    Tooltip: ({ children }: any) => React.createElement("div", null, children),
    useToast: () => ({ toast: () => {} }),
    Menu,
  };
});

vi.mock("../../src/lib/api", () => ({
  api: { createFrame: vi.fn() },
}));

vi.mock("../../src/hooks/useFrames", () => ({
  useFrames: (project: Project) => ({
    frames: project.frames,
    refresh: () => {},
  }),
}));

vi.mock("../../src/hooks/targetSelectionContext", () => ({
  useTargetSelection: () => ({
    target: null,
    setTarget: () => {},
  }),
}));

import { Viewport } from "../../src/components/viewport/Viewport";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const projectWithFrame: Project = {
  slug: "demo",
  name: "Demo",
  theme: "arcade",
  mode: "light",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  frames: [
    {
      slug: "home",
      name: "Home",
      size: "1440",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
};

describe("Viewport live cursor integration", () => {
  it("renders live-cursor testid when phase=running and agentCursor is set", () => {
    const { container } = render(
      <Viewport
        project={projectWithFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        phase="running"
        agentCursor={{
          frame: "home",
          action: "writing",
          composites: ["Hero"],
          updatedAt: Date.now(),
        }}
      />,
    );
    expect(container.querySelector('[data-testid="live-cursor"]')).not.toBeNull();
  });

  it("does NOT render live-cursor testid when phase=idle", () => {
    const { container } = render(
      <Viewport
        project={projectWithFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        phase="idle"
        agentCursor={null}
      />,
    );
    expect(container.querySelector('[data-testid="live-cursor"]')).toBeNull();
  });

  it("does NOT render live-cursor when agentCursor is null even if phase=running", () => {
    const { container } = render(
      <Viewport
        project={projectWithFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        phase="running"
        agentCursor={null}
      />,
    );
    expect(container.querySelector('[data-testid="live-cursor"]')).toBeNull();
  });

  it("defaults agentCursor to null when not passed", () => {
    const { container } = render(
      <Viewport
        project={projectWithFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
      />,
    );
    // No cursor rendered without explicit props
    expect(container.querySelector('[data-testid="live-cursor"]')).toBeNull();
  });

  it("defaults phase to idle when not passed", () => {
    const { container } = render(
      <Viewport
        project={projectWithFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        agentCursor={{
          frame: "home",
          action: "writing",
          composites: [],
          updatedAt: Date.now(),
        }}
      />,
    );
    // No cursor rendered when phase defaults to idle
    expect(container.querySelector('[data-testid="live-cursor"]')).toBeNull();
  });
});
