// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { Project } from "../../server/types";

// Mock @xorkavi/arcade-gen to avoid gridstack ESM resolution issues
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

vi.mock("../../src/hooks/useFrames", () => ({
  useFrames: (project: Project) => ({ frames: project.frames, refresh: () => {} }),
}));

vi.mock("../../src/hooks/editSessionContext", () => ({
  useEditSession: () => ({
    batch: [],
    frameSlug: null,
    addOrFocus: () => {},
    setInspectorOpen: () => {},
    clear: () => {},
    frameWindow: null,
  }),
}));

import { Viewport } from "../../src/components/viewport/Viewport";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const threeFrameProject: Project = {
  slug: "demo",
  name: "Demo",
  theme: "arcade",
  mode: "light",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  frames: [
    { slug: "01-gallery", name: "Gallery", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
    { slug: "02-modal", name: "Modal", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
    { slug: "03-settings", name: "Settings", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
  ],
  chimeIns: [],
};

function renderViewport() {
  return render(
    <Viewport
      project={threeFrameProject}
      frameWidth={1440}
      onFrameWidthChange={() => {}}
      zoom={1}
      onZoomChange={() => {}}
      onSeedChat={() => {}}
    />,
  );
}

describe("Viewport navigate-message handling", () => {
  it("renders a data-frame-slug attribute on each FrameCard", () => {
    const { container } = renderViewport();
    expect(container.querySelector('[data-frame-slug="01-gallery"]')).toBeTruthy();
    expect(container.querySelector('[data-frame-slug="02-modal"]')).toBeTruthy();
    expect(container.querySelector('[data-frame-slug="03-settings"]')).toBeTruthy();
  });

  it("scrolls the target frame into view when a navigate message arrives", () => {
    const { container } = renderViewport();
    const target = container.querySelector('[data-frame-slug="02-modal"]') as HTMLElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "arcade-studio:navigate", target: "02-modal" },
        }),
      );
    });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "smooth",
        inline: "center",
      }),
    );
  });

  it("applies a highlight data attribute to the target frame", () => {
    const { container } = renderViewport();
    const target = container.querySelector('[data-frame-slug="02-modal"]') as HTMLElement;
    target.scrollIntoView = vi.fn();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "arcade-studio:navigate", target: "02-modal" },
        }),
      );
    });

    expect(target.getAttribute("data-nav-highlight")).toBe("target");
  });

  it("highlights the source frame with 'missing' when the target does not exist", () => {
    const { container } = renderViewport();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "arcade-studio:navigate", target: "99-does-not-exist", source: "01-gallery" },
        }),
      );
    });

    const source = container.querySelector('[data-frame-slug="01-gallery"]') as HTMLElement;
    expect(source.getAttribute("data-nav-highlight")).toBe("missing");
  });

  it("ignores unrelated messages", () => {
    const { container } = renderViewport();
    const target = container.querySelector('[data-frame-slug="02-modal"]') as HTMLElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "arcade-studio:canvas-wheel", deltaY: 10 },
        }),
      );
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
