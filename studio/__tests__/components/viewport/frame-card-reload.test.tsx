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

function baseProps(overrides: { projectSlug: string; frame: Frame; editSession?: any; refineTimeoutMs?: number }) {
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
    ...(overrides.refineTimeoutMs != null ? { refineTimeoutMs: overrides.refineTimeoutMs } : {}),
  };
}

describe("FrameCard targeted reload", () => {
  it("bumps the reload nonce (on the incoming probe iframe) when a matching frame-changed event fires", () => {
    const { container } = render(
      <FrameCard
        {...baseProps({
          projectSlug: "proj",
          frame: { slug: "01-frame", name: "F", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
        })}
      />
    );
    // Before: only the committed (last-good) iframe, no reload nonce.
    expect(container.querySelectorAll("iframe").length).toBe(1);
    const committed = container.querySelector("iframe[data-frame-active='true']")!;
    const committedSrc = committed.getAttribute("src")!;
    act(() => {
      window.dispatchEvent(
        new CustomEvent("arcade-studio:frame-changed", {
          detail: { slug: "proj", frameId: "01-frame" },
        })
      );
    });
    // Double-buffer: the reload does NOT touch the visible iframe. A hidden
    // incoming probe mounts at the bumped nonce; the committed src is unchanged.
    expect(committed.getAttribute("src")).toBe(committedSrc);
    const incoming = container.querySelector("iframe:not([data-frame-active='true'])")!;
    expect(incoming).toBeTruthy();
    expect(incoming.getAttribute("src")).toMatch(/[?&]n=/);
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

describe("FrameCard double-buffer render (hold last-good)", () => {
  const F: Frame = { slug: "01", name: "F", size: "1440", createdAt: "2026-01-01T00:00:00Z" };

  it("keeps the last-good iframe visible and shows the chip on a nonce-matched frame-error", () => {
    const { container, getByText } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: F })} />);
    // trigger a reload → nonce becomes 1
    act(() => {
      window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01" } }));
    });
    // incoming iframe errors with the CURRENT nonce
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-error", slug: "proj", frame: "01", n: "1", message: "Select is not defined" } }));
    });
    expect(getByText(/refining your change/i)).toBeTruthy();
    // the visible (last-good) iframe is still the pre-reload one (not swapped)
    const active = container.querySelector("iframe[data-frame-active='true']")!;
    expect(active).toBeTruthy();
    // its src still points at the pre-reload nonce (no &n=1) — last-good held
    expect(active.getAttribute("src")).not.toMatch(/[?&]n=1\b/);
    // the incoming (hidden) iframe was discarded on error
    expect(container.querySelectorAll("iframe").length).toBe(1);
  });

  it("ignores a stale-nonce message from the outgoing iframe", () => {
    const { queryByText } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: F })} />);
    act(() => {
      window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01" } })); // nonce=1
    });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-error", slug: "proj", frame: "01", n: "0", message: "old" } }));
    });
    expect(queryByText(/refining your change/i)).toBeNull(); // nonce 0 != current 1
  });

  it("swaps and clears the chip on a nonce-matched frame-ready", () => {
    const { container, queryByText } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: F })} />);
    act(() => {
      window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01" } }));
    });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-error", slug: "proj", frame: "01", n: "1", message: "x" } }));
    });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-ready", slug: "proj", frame: "01", n: "1" } }));
    });
    expect(queryByText(/refining your change/i)).toBeNull();
    // committed advanced to the validated nonce; incoming discarded
    const active = container.querySelector("iframe[data-frame-active='true']")!;
    expect(active.getAttribute("src")).toMatch(/[?&]n=1\b/);
    expect(container.querySelectorAll("iframe").length).toBe(1);
  });

  it("goes terminal after the timer, and recovers if a late frame-ready arrives", () => {
    vi.useFakeTimers();
    const { getByText, queryByText } = render(<FrameCard {...baseProps({ projectSlug: "proj", frame: F, refineTimeoutMs: 90_000 })} />);
    act(() => {
      window.dispatchEvent(new CustomEvent("arcade-studio:frame-changed", { detail: { slug: "proj", frameId: "01" } }));
    });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-error", slug: "proj", frame: "01", n: "1", message: "x" } }));
    });
    act(() => {
      vi.advanceTimersByTime(90_001);
    });
    expect(getByText(/couldn't get that change right/i)).toBeTruthy();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:frame-ready", slug: "proj", frame: "01", n: "1" } }));
    });
    expect(queryByText(/couldn't get that change right/i)).toBeNull(); // late win un-terminals
    vi.useRealTimers();
  });
});
