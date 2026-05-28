import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock the data hooks BEFORE importing the component under test. The
// spectator branch (`mode="spectator"`) must call `useProjectFromMirror`
// with the supplied id and must NOT call `useProjectFromHost`. The
// author branch is the inverse.
const mockHostHook = vi.fn();
const mockMirrorHook = vi.fn();

vi.mock("../../../src/hooks/useProjectFromHost", () => ({
  useProjectFromHost: (slug: string) => mockHostHook(slug),
}));

vi.mock("../../../src/hooks/useProjectFromMirror", () => ({
  useProjectFromMirror: (id: string) => mockMirrorHook(id),
}));

// Stub the heavy children. Each renders a marker exposing the props it
// received so we can assert Task-4 props without depending on Tasks 5/6.
vi.mock("../../../src/components/viewport/Viewport", () => ({
  Viewport: (props: { readonly?: boolean }) => (
    <div data-testid="viewport-stub" data-readonly={String(Boolean(props.readonly))} />
  ),
}));

vi.mock("../../../src/components/chat/ChatPane", () => ({
  ChatPane: (props: { readonly?: boolean }) => (
    <div data-testid="chatpane-stub" data-readonly={String(Boolean(props.readonly))} />
  ),
}));

// DevModePanel + SharePanel + ShareButton + ProjectPicker should not
// appear in spectator mode. Stub them to a recognisable marker so we
// can assert their absence without rendering their real internals
// (which pull in arcade-gen, fetch, etc.).
vi.mock("../../../src/components/devmode/DevModePanel", () => ({
  DevModePanel: () => <div data-testid="devmode-panel" />,
}));

vi.mock("../../../src/components/multiplayer/SharePanel", () => ({
  SharePanel: () => <div data-testid="share-panel" />,
}));

vi.mock("../../../src/components/multiplayer/PresenceStrip", () => ({
  PresenceStrip: () => <div data-testid="presence-strip" />,
}));

vi.mock("../../../src/components/shell/ShareButton", () => ({
  ShareButton: () => <button data-testid="share-button">share</button>,
}));

vi.mock("../../../src/components/shell/ProjectPicker", () => ({
  ProjectPicker: () => <div data-testid="project-picker" />,
}));

vi.mock("../../../src/components/shell/CanvasToggle", () => ({
  CanvasToggle: ({ onToggle }: { active: boolean; onToggle: () => void }) => (
    <button data-testid="canvas-toggle" onClick={onToggle}>devmode</button>
  ),
}));

vi.mock("../../../src/components/shell/ChatToggle", () => ({
  ChatToggle: () => <button data-testid="chat-toggle" />,
}));

vi.mock("../../../src/components/shell/ThemeToggle", () => ({
  ThemeToggle: () => <button data-testid="theme-toggle" />,
}));

// arcade-gen pulls heavy ESM (gridstack); stub the bits the component uses.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  return {
    IconButton: passthrough("button"),
    Tooltip: ({ children }: any) => React.createElement("div", null, children),
  };
});

// Stable hook return value used by both branches.
function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      slug: "p-1",
      name: "Demo",
      theme: "arcade" as const,
      mode: "light" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      frames: [],
    },
    chatHistory: [],
    chat: {} as any,
    chatStream: { state: {}, send: async () => {}, retry: () => {} } as any,
    presence: { host: null, guests: [] },
    status: "online" as const,
    refresh: async () => {},
    ...overrides,
  };
}

import { ProjectDetail } from "../../../src/routes/ProjectDetail";

afterEach(() => {
  cleanup();
  mockHostHook.mockReset();
  mockMirrorHook.mockReset();
});

describe("ProjectDetail spectator mode", () => {
  it("calls useProjectFromMirror with the supplied id and does not call useProjectFromHost", () => {
    mockMirrorHook.mockReturnValue(makeSource({ send: undefined, postComment: async () => {} }));

    render(
      <ProjectDetail
        mode="spectator"
        id="p-1"
        onBack={() => {}}
        onOpenProject={() => {}}
      />,
    );

    expect(mockMirrorHook).toHaveBeenCalledWith("p-1");
    expect(mockHostHook).not.toHaveBeenCalled();
  });

  it("threads readonly={true} into Viewport and ChatPane in spectator mode", () => {
    mockMirrorHook.mockReturnValue(makeSource({ send: undefined, postComment: async () => {} }));

    render(
      <ProjectDetail
        mode="spectator"
        id="p-1"
        onBack={() => {}}
        onOpenProject={() => {}}
      />,
    );

    expect(screen.getByTestId("viewport-stub").getAttribute("data-readonly")).toBe("true");
    expect(screen.getByTestId("chatpane-stub").getAttribute("data-readonly")).toBe("true");
  });

  it("hides host-only chrome (ShareButton, ProjectPicker, SharePanel toggle, DevModePanel toggle) in spectator mode", () => {
    mockMirrorHook.mockReturnValue(makeSource({ send: undefined, postComment: async () => {} }));

    render(
      <ProjectDetail
        mode="spectator"
        id="p-1"
        onBack={() => {}}
        onOpenProject={() => {}}
      />,
    );

    expect(screen.queryByTestId("share-button")).toBeNull();
    expect(screen.queryByTestId("project-picker")).toBeNull();
    // The teammates icon button (which toggles SharePanel) is host-only.
    expect(screen.queryByLabelText(/share with teammates/i)).toBeNull();
    // Devmode toggle is host-only.
    expect(screen.queryByTestId("canvas-toggle")).toBeNull();
  });

  it("calls useProjectFromHost with the supplied slug in author mode (no regression)", () => {
    mockHostHook.mockReturnValue(makeSource({ send: () => {}, postComment: undefined }));

    render(
      <ProjectDetail
        mode="author"
        slug="my-slug"
        onBack={() => {}}
        onOpenProject={() => {}}
      />,
    );

    expect(mockHostHook).toHaveBeenCalledWith("my-slug");
    expect(mockMirrorHook).not.toHaveBeenCalled();
  });

  it("threads readonly={false} into Viewport and ChatPane in author mode", () => {
    mockHostHook.mockReturnValue(makeSource({ send: () => {}, postComment: undefined }));

    render(
      <ProjectDetail
        mode="author"
        slug="my-slug"
        onBack={() => {}}
        onOpenProject={() => {}}
      />,
    );

    expect(screen.getByTestId("viewport-stub").getAttribute("data-readonly")).toBe("false");
    expect(screen.getByTestId("chatpane-stub").getAttribute("data-readonly")).toBe("false");
    // Host-only chrome remains in author mode.
    expect(screen.getByTestId("share-button")).toBeTruthy();
    expect(screen.getByTestId("project-picker")).toBeTruthy();
    expect(screen.getByLabelText(/share with teammates/i)).toBeTruthy();
    expect(screen.getByTestId("canvas-toggle")).toBeTruthy();
  });
});
