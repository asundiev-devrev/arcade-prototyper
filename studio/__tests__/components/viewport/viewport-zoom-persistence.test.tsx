import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

// Mock arcade-gen pieces used by ProjectDetail's subtree. Minimal passthroughs.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  const Menu: any = {
    Root: ({ children }: any) => React.createElement("div", null, children),
    Trigger: ({ children }: any) => React.createElement("div", null, children),
    Content: ({ children }: any) => React.createElement("div", null, children),
    Item: ({ children, ...rest }: any) =>
      React.createElement("button", rest, children),
  };
  const ToggleGroup: any = {
    Root: ({ children }: any) => React.createElement("div", null, children),
    Item: ({ children, ...rest }: any) =>
      React.createElement("button", rest, children),
  };
  return {
    Button: passthrough("button"),
    IconButton: passthrough("button"),
    Tooltip: ({ children }: any) => children,
    useToast: () => ({ toast: () => {} }),
    Menu,
    ToggleGroup,
    ArrowUpRightSmall: () => null,
    ChevronDownSmall: () => null,
    ThreeDotsHorizontal: () => null,
  };
});

// Mock the chat pane and dev-mode panel so we don't pull the full chat stack.
vi.mock("../../../src/components/chat/ChatPane", () => ({
  ChatPane: () => null,
}));
vi.mock("../../../src/components/devmode/DevModePanel", () => ({
  DevModePanel: () => null,
}));
vi.mock("../../../src/components/shell/StudioHeader", () => ({
  StudioHeader: ({ title, right }: any) => (
    <div>{title}{right}</div>
  ),
}));
vi.mock("../../../src/components/shell/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));
vi.mock("../../../src/components/shell/ShareButton", () => ({
  ShareButton: () => null,
}));
vi.mock("../../../src/components/shell/CanvasToggle", () => ({
  CanvasToggle: () => null,
}));
vi.mock("../../../src/components/shell/ChatToggle", () => ({
  ChatToggle: () => null,
}));
vi.mock("../../../src/components/shell/ProjectPicker", () => ({
  ProjectPicker: () => null,
}));

// Stub useFrames so Viewport renders the ViewportPreview (with transform: scale())
// instead of the EmptyViewport early-return.
vi.mock("../../../src/hooks/useFrames", () => ({
  useFrames: () => ({
    frames: [
      {
        slug: "f1",
        name: "Frame 1",
        createdAt: "0",
        size: "1440",
      },
    ],
    refresh: () => {},
  }),
}));

// Stub FrameCard to keep the subtree minimal.
vi.mock("../../../src/components/viewport/FrameCard", () => ({
  FrameCard: () => null,
}));

import { ProjectDetail } from "../../../src/routes/ProjectDetail";

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/projects/my-slug")) {
      return new Response(
        JSON.stringify({
          slug: "my-slug",
          name: "My",
          mode: "light",
          updatedAt: 0,
          frames: [],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/frames/")) {
      return new Response(JSON.stringify({ frames: [] }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as any;
});

afterEach(() => cleanup());

describe("ProjectDetail zoom persistence", () => {
  it("reads zoom from localStorage on mount, keyed by slug", async () => {
    window.localStorage.setItem("studio:zoom:my-slug", "0.5");
    render(
      <ProjectDetail slug="my-slug" onBack={() => {}} onOpenProject={() => {}} />,
    );
    await waitFor(() => {
      // The viewport wraps content in a transform scale(0.5). Assert the style
      // reflects the stored value.
      const scaled = document.querySelector<HTMLElement>('[style*="scale(0.5)"]');
      expect(scaled).toBeTruthy();
    });
  });

  it("defaults to 1.0 when nothing is stored", async () => {
    render(
      <ProjectDetail slug="my-slug" onBack={() => {}} onOpenProject={() => {}} />,
    );
    await waitFor(() => {
      const scaled = document.querySelector<HTMLElement>('[style*="scale(1)"]');
      expect(scaled).toBeTruthy();
    });
  });

  it("writes zoom to localStorage when state changes", async () => {
    render(
      <ProjectDetail slug="my-slug" onBack={() => {}} onOpenProject={() => {}} />,
    );
    // Initial render writes the default 1.0.
    await waitFor(() => {
      expect(window.localStorage.getItem("studio:zoom:my-slug")).toBe("1");
    });
  });
});
