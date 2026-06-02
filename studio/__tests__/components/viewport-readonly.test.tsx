// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
    TrashBin: () => null,
    Tooltip: ({ children }: any) => React.createElement("div", null, children),
    useToast: () => ({ toast: () => {} }),
    Menu,
  };
});

vi.mock("../../src/lib/api", () => ({
  api: { createFrame: vi.fn() },
}));

// Track useFrames calls so we can assert spectators pass `enabled: false`.
const useFramesSpy = vi.fn(
  (_project: Project, _opts?: { enabled?: boolean }) => ({
    frames: [] as Project["frames"],
    refresh: () => {},
  }),
);
vi.mock("../../src/hooks/useFrames", () => ({
  useFrames: (project: Project, opts?: { enabled?: boolean }) => {
    useFramesSpy(project, opts);
    return { frames: project.frames, refresh: () => {} };
  },
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
  useFramesSpy.mockClear();
});

const projectWithOneFrame: Project = {
  slug: "demo",
  name: "Demo",
  theme: "arcade",
  mode: "light",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  frames: [
    {
      slug: "01-home",
      name: "Home",
      size: "1440",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
  chimeIns: [],
};

const emptyProject: Project = {
  ...projectWithOneFrame,
  frames: [],
};

describe("Viewport readonly mode", () => {
  it("does NOT render the New frame card when readonly", () => {
    render(
      <Viewport
        project={projectWithOneFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        readonly
      />,
    );
    expect(screen.queryByRole("button", { name: /new frame/i })).toBeNull();
  });

  it("does NOT render an empty-state create button when readonly with no frames", () => {
    render(
      <Viewport
        project={emptyProject}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        readonly
      />,
    );
    // Empty viewport in spectator mode shows a placeholder, not a CTA.
    expect(screen.queryByRole("button", { name: /new frame/i })).toBeNull();
  });

  it("calls useFrames with enabled=false when readonly", () => {
    render(
      <Viewport
        project={projectWithOneFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        readonly
      />,
    );
    expect(useFramesSpy).toHaveBeenCalled();
    const call = useFramesSpy.mock.calls[0];
    expect(call[1]).toEqual(expect.objectContaining({ enabled: false }));
  });

  it("calls useFrames with enabled!=false when not readonly (author mode)", () => {
    render(
      <Viewport
        project={projectWithOneFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
      />,
    );
    expect(useFramesSpy).toHaveBeenCalled();
    const call = useFramesSpy.mock.calls[0];
    // Either undefined opts or { enabled: true } — both keep the polling
    // hook live in author mode.
    const opts = call[1];
    expect(opts === undefined || opts?.enabled !== false).toBe(true);
  });

  it("renders the New frame card in author mode", () => {
    render(
      <Viewport
        project={projectWithOneFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /new frame/i })).toBeTruthy();
  });

  it("uses srcOverride for FrameCard iframe src when provided", () => {
    const srcOverride = (slug: string) =>
      `/api/shared-projects/abc/frame/${encodeURIComponent(slug)}`;
    const { container } = render(
      <Viewport
        project={projectWithOneFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        readonly
        frameSrcOverride={srcOverride}
      />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain("/api/shared-projects/abc/frame/01-home");
  });
});
