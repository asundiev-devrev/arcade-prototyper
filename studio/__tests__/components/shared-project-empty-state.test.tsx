import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Empty-state assertion for a spectator viewing a shared project that
// has no frames yet. The bespoke `SharedProject` route was retired —
// spectators now render through `ProjectDetail mode="spectator"` and
// the empty-state copy lives in `Viewport` (gated by `readonly`).
//
// Mock the data hook so the shell renders synchronously with an empty
// `project.frames` array. We deliberately leave Viewport un-stubbed so
// the assertion exercises the real readonly empty-state branch.

const mockMirrorHook = vi.fn();
const mockHostHook = vi.fn();

vi.mock("../../src/hooks/useProjectFromMirror", () => ({
  useProjectFromMirror: (id: string) => mockMirrorHook(id),
}));

vi.mock("../../src/hooks/useProjectFromHost", () => ({
  useProjectFromHost: (slug: string) => mockHostHook(slug),
}));

// useFrames is what Viewport reads its frame list from. Spectator mode
// passes `enabled: false` so no fetch is fired; we still mock to return
// the project's initial frames synchronously.
vi.mock("../../src/hooks/useFrames", () => ({
  useFrames: (project: { frames?: unknown[] } | null) => ({
    frames: project?.frames ?? [],
  }),
}));

// ChatPane pulls in chat plumbing we don't need here. Stub it so the
// test focuses on the viewport empty-state copy.
vi.mock("../../src/components/chat/ChatPane", () => ({
  ChatPane: () => <div data-testid="chatpane-stub" />,
}));

// Host-only chrome stubs (mirrors project-detail-spectator-mode test).
vi.mock("../../src/components/devmode/DevModePanel", () => ({
  DevModePanel: () => <div data-testid="devmode-panel" />,
}));
vi.mock("../../src/components/multiplayer/SharePanel", () => ({
  SharePanel: () => <div data-testid="share-panel" />,
}));
vi.mock("../../src/components/multiplayer/PresenceStrip", () => ({
  PresenceStrip: () => <div data-testid="presence-strip" />,
}));
vi.mock("../../src/components/shell/ShareButton", () => ({
  ShareButton: () => <button data-testid="share-button">share</button>,
}));
vi.mock("../../src/components/shell/ProjectPicker", () => ({
  ProjectPicker: () => <div data-testid="project-picker" />,
}));
vi.mock("../../src/components/shell/CanvasToggle", () => ({
  CanvasToggle: () => <button data-testid="canvas-toggle" />,
}));
vi.mock("../../src/components/shell/ChatToggle", () => ({
  ChatToggle: () => <button data-testid="chat-toggle" />,
}));
vi.mock("../../src/components/shell/ThemeToggle", () => ({
  ThemeToggle: () => <button data-testid="theme-toggle" />,
}));

// arcade-gen pulls heavy ESM (gridstack); stub the bits the shell uses.
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

import { ProjectDetail } from "../../src/routes/ProjectDetail";

afterEach(() => {
  cleanup();
  mockMirrorHook.mockReset();
  mockHostHook.mockReset();
});

describe("Shared project empty-state (spectator shell)", () => {
  it("explains why the viewport is empty when no frames have arrived", () => {
    mockMirrorHook.mockReturnValue({
      project: {
        slug: "discover-v1",
        name: "Discover",
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
      status: "unknown" as const,
      send: undefined,
      postComment: async () => {},
      refresh: async () => {},
    });

    render(
      <ProjectDetail
        mode="spectator"
        id="p-1"
        onBack={() => {}}
        onOpenProject={() => {}}
      />,
    );

    // Spectator empty-state copy comes from Viewport's readonly branch.
    expect(screen.getByText(/Waiting for the host to generate frames/i)).toBeTruthy();
  });
});
