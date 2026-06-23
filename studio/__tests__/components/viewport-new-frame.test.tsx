import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { Project } from "../../server/types";

// Mock @xorkavi/arcade-gen to avoid gridstack ESM resolution issues pulled in
// via the Dashboard re-export. Provides minimal shims for the components used
// by FrameCard.
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
    useToast: () => ({ showToast: () => {}, toast: () => {} }),
    Menu,
  };
});

// Mock the api module; only createFrame matters here.
vi.mock("../../src/lib/api", () => ({
  api: {
    createFrame: vi.fn(),
  },
}));

// Mock the useFrames hook to return a deterministic list (no polling).
vi.mock("../../src/hooks/useFrames", () => ({
  useFrames: (project: Project) => ({ frames: project.frames, refresh: () => {} }),
}));

// Mock the editSessionContext to avoid provider errors
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

describe("Viewport + NewFrameCard", () => {
  it("renders the + New frame card alongside existing frames", () => {
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

  it("creates a frame and seeds the chat on click", async () => {
    const { api } = await import("../../src/lib/api");
    (api.createFrame as any).mockResolvedValueOnce({
      slug: "02-untitled-1",
      name: "Untitled 1",
      size: "1440",
      createdAt: "2026-01-02T00:00:00Z",
    });

    const onSeedChat = vi.fn();
    render(
      <Viewport
        project={projectWithOneFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={onSeedChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /new frame/i }));

    await waitFor(() => expect(api.createFrame).toHaveBeenCalledWith("demo"));
    await waitFor(() =>
      expect(onSeedChat).toHaveBeenCalledWith("Design the Untitled 1 screen: "),
    );
  });
});
