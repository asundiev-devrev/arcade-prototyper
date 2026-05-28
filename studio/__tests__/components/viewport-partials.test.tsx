// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Project } from "../../server/types";

// Mock @xorkavi/arcade-gen — same shim as viewport-live-cursor.test.tsx.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  const Menu: any = ({ children }: any) =>
    React.createElement("div", null, children);
  Menu.Root = ({ children }: any) =>
    React.createElement("div", null, children);
  Menu.Trigger = React.forwardRef(
    ({ children, asChild, ...rest }: any, ref: any) =>
      asChild
        ? React.cloneElement(children, { ...rest, ref })
        : React.createElement("button", { ...rest, ref }, children),
  );
  Menu.Content = ({ children }: any) =>
    React.createElement("div", null, children);
  Menu.Item = ({ children, ...rest }: any) =>
    React.createElement("div", rest, children);
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

const projectEmpty: Project = {
  slug: "p1",
  name: "P1",
  theme: "arcade",
  mode: "light",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  frames: [],
};

describe("Viewport — partial pipeline integration", () => {
  it("renders PhantomSkeleton + NarrationTicker when running with no frames", () => {
    const { container } = render(
      <Viewport
        project={projectEmpty}
        frameWidth={1024}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        agentCursor={null}
        phase="running"
        narrations={["Reading kit-manifest.md"]}
        activeWrites={{}}
      />,
    );
    expect(
      container.querySelector('[data-testid="phantom-skeleton"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="narration-ticker"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="code-stream-panel"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="edit-cursor"]')).toBeNull();
  });

  it("does not render NarrationTicker on idle empty viewport", () => {
    const { container } = render(
      <Viewport
        project={projectEmpty}
        frameWidth={1024}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        agentCursor={null}
        phase="idle"
        narrations={[]}
        activeWrites={{}}
      />,
    );
    expect(
      container.querySelector('[data-testid="narration-ticker"]'),
    ).toBeNull();
  });
});
