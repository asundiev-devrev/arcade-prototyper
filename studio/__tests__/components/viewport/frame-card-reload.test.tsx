// @vitest-environment jsdom
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock @xorkavi/arcade-gen to avoid ESM resolution issues
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
    TrashBin: () => null,
    Tooltip: ({ children }: any) => React.createElement("div", null, children),
    useToast: () => ({ toast: () => {} }),
    Button: passthrough("button"),
    Menu,
  };
});

let mockEditSession = {
  batch: [],
  frameSlug: null,
  addOrFocus: () => {},
  setInspectorOpen: () => {},
  clear: () => {},
  frameWindow: null,
};

vi.mock("../../../src/hooks/editSessionContext", () => ({
  useEditSession: () => mockEditSession,
}));

import { FrameCard } from "../../../src/components/viewport/FrameCard";
import type { Frame } from "../../../server/types";

afterEach(() => {
  vi.clearAllMocks();
  mockEditSession = {
    batch: [],
    frameSlug: null,
    addOrFocus: () => {},
    setInspectorOpen: () => {},
    clear: () => {},
    frameWindow: null,
  };
});

function baseProps(overrides: { projectSlug: string; frame: Frame; editSession?: any }) {
  if (overrides.editSession) {
    mockEditSession = { ...mockEditSession, ...overrides.editSession };
  }
  return {
    projectSlug: overrides.projectSlug,
    frame: overrides.frame,
    frameWidth: 1440,
    onFrameWidthChange: () => {},
    projectMode: "light" as const,
    zoom: 1,
    phase: "idle" as const,
  };
}

describe("FrameCard targeted reload", () => {
  it("bumps the iframe src nonce when a matching frame-changed event fires", () => {
    const { container } = render(
      <FrameCard
        {...baseProps({
          projectSlug: "proj",
          frame: { slug: "01-frame", name: "F", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
        })}
      />
    );
    const iframe = container.querySelector("iframe")!;
    const before = iframe.getAttribute("src")!;
    act(() => {
      window.dispatchEvent(
        new CustomEvent("arcade-studio:frame-changed", {
          detail: { slug: "proj", frameId: "01-frame" },
        })
      );
    });
    const after = iframe.getAttribute("src")!;
    expect(after).not.toBe(before);
    expect(after).toMatch(/[?&]n=/);
  });

  it("ignores frame-changed for a different frame", () => {
    const { container } = render(
      <FrameCard
        {...baseProps({
          projectSlug: "proj",
          frame: { slug: "01-frame", name: "F", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
        })}
      />
    );
    const iframe = container.querySelector("iframe")!;
    const before = iframe.getAttribute("src")!;
    act(() => {
      window.dispatchEvent(
        new CustomEvent("arcade-studio:frame-changed", {
          detail: { slug: "proj", frameId: "02-other" },
        })
      );
    });
    expect(iframe.getAttribute("src")).toBe(before);
  });

  it("removes the frame-changed listener on unmount (no leak)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <FrameCard
        {...baseProps({
          projectSlug: "proj",
          frame: { slug: "01-frame", name: "F", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
        })}
      />
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("arcade-studio:frame-changed", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("clears the edit session when the ACTIVE frame reloads (stale ids/window)", () => {
    const clear = vi.fn();
    render(<FrameCard {...baseProps({
      projectSlug: "proj", frame: { slug: "01-frame", name: "F", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
      editSession: { frameSlug: "01-frame", batch: [{ selection: { editId: 1 } }], clear },
    })} />);
    act(() => {
      window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01-frame" } }));
    });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does NOT clear when a different frame reloads", () => {
    const clear = vi.fn();
    render(<FrameCard {...baseProps({
      projectSlug: "proj", frame: { slug: "02-other", name: "O", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
      editSession: { frameSlug: "01-frame", batch: [{ selection: { editId: 1 } }], clear },
    })} />);
    act(() => {
      window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01-frame" } }));
    });
    expect(clear).not.toHaveBeenCalled();
  });
});
