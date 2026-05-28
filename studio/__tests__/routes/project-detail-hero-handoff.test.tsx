// @vitest-environment jsdom
//
// Regression for 0.23.6: when the user submits from HomePage we redirect to
// the new project's route. The route's effect is supposed to drain the
// pending-prompt bucket and call `send()` once. Pre-fix, the effect synchronously
// flipped `consumedRef.current = true` BEFORE the IIFE that calls `send()` ran.
// Under React's StrictMode (active in dev / Vite-served Studio), the effect
// runs `setup → cleanup → setup`. Mount #1 sets consumedRef and queues the
// IIFE. The cleanup function flips the closure's `cancelled = true` flag.
// Mount #2 sees consumedRef already true and bails. When mount #1's IIFE
// finally drains, it sees `cancelled === true` and returns before calling
// `send()`. Result: the prompt is never sent, the chat pane stays idle, no
// "Working…" row, no Stop button — exactly the dead-window symptom users
// reported on the hero handoff.
//
// This test pins the post-fix behaviour: even under StrictMode, send() must
// be called exactly once with the pending prompt.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { StrictMode } from "react";
import { render, cleanup, waitFor } from "@testing-library/react";

import { setPendingPrompt, __resetPendingPromptForTests } from "../../src/lib/pendingPrompt";

const { sendSpy, adoptSpy } = vi.hoisted(() => ({
  sendSpy: vi.fn(),
  adoptSpy: vi.fn(async (_slug: string, paths: string[]) => ({
    mapping: Object.fromEntries(paths.map((p) => [p, p])),
  })),
}));

function makeSource() {
  return {
    project: {
      slug: "p-strict",
      name: "Demo",
      theme: "arcade" as const,
      mode: "light" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      frames: [],
    },
    chatHistory: [],
    chat: {} as any,
    chatStream: { state: {}, send: sendSpy, retry: () => {}, cancel: () => {} } as any,
    presence: { host: null, guests: [] },
    status: "online" as const,
    send: sendSpy,
    refresh: async () => {},
  };
}

vi.mock("../../src/hooks/useProjectFromHost", () => ({
  useProjectFromHost: (_slug: string) => makeSource(),
}));

vi.mock("../../src/hooks/useProjectFromMirror", () => ({
  useProjectFromMirror: (_id: string) => makeSource(),
}));

// Stub heavy children — irrelevant to the hero-handoff effect under test.
vi.mock("../../src/components/viewport/Viewport", () => ({
  Viewport: () => <div data-testid="viewport-stub" />,
}));
vi.mock("../../src/components/chat/ChatPane", () => ({
  ChatPane: () => <div data-testid="chatpane-stub" />,
}));
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
  ShareButton: () => <button data-testid="share-button" />,
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
vi.mock("../../src/components/shell/StudioHeader", () => ({
  StudioHeader: ({ title, right }: any) => (
    <div data-testid="studio-header">{title}{right}</div>
  ),
}));
vi.mock("../../src/components/shell/BackButton", () => ({
  BackButton: () => <button data-testid="back-button" />,
}));

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

vi.mock("../../src/lib/api", () => ({
  api: {
    adoptUploads: adoptSpy,
  },
}));

import { ProjectDetail } from "../../src/routes/ProjectDetail";

beforeEach(() => {
  sendSpy.mockReset();
  adoptSpy.mockClear();
  __resetPendingPromptForTests();
});

afterEach(() => {
  cleanup();
});

describe("ProjectDetail hero handoff under StrictMode", () => {
  it("calls send() exactly once when a pending prompt exists (no images)", async () => {
    setPendingPrompt("p-strict-1", {
      prompt: "Build a settings page",
      imagePaths: [],
      figmaUrl: null,
    });

    render(
      <StrictMode>
        <ProjectDetail
          mode="author"
          slug="p-strict-1"
          onBack={() => {}}
          onOpenProject={() => {}}
        />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
    expect(sendSpy).toHaveBeenCalledWith("Build a settings page", []);
  });

  it("calls send() exactly once when a pending prompt has images", async () => {
    setPendingPrompt("p-strict-2", {
      prompt: "Style this card",
      imagePaths: ["/uploads/staging/abc.png"],
      figmaUrl: null,
    });

    render(
      <StrictMode>
        <ProjectDetail
          mode="author"
          slug="p-strict-2"
          onBack={() => {}}
          onOpenProject={() => {}}
        />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
    expect(adoptSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      "Style this card",
      ["/uploads/staging/abc.png"],
    );
  });
});
