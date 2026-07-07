import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

// Capture the mode prop passed to DevRevThemeProvider.
const seenModes: string[] = [];
vi.mock("@xorkavi/arcade-gen", async () => {
  const R = await import("react");
  return {
    DevRevThemeProvider: ({ mode, children }: any) => {
      seenModes.push(mode);
      return R.createElement("div", { "data-mode": mode }, children);
    },
    Toaster: () => null,
  };
});

// Stub the child routes + providers so App mounts without a server.
vi.mock("../../src/frame/FrameFontProxy", () => ({ FrameFontProxy: () => null }));
vi.mock("../../src/routes/HomePage", () => ({ HomePage: () => null }));
vi.mock("../../src/routes/ProjectDetail", () => ({ ProjectDetail: () => null }));
vi.mock("../../src/components/feedback/StartupAuthGate", () => ({ StartupAuthGate: ({ children }: any) => children }));
vi.mock("../../src/components/feedback/WhatsNewModal", () => ({ WhatsNewModal: () => null }));
vi.mock("../../src/components/feedback/UpdateBanner", () => ({ UpdateBanner: () => null }));
vi.mock("../../src/components/feedback/Dialogs", () => ({ DialogsProvider: ({ children }: any) => children }));

import { App } from "../../src/App";

afterEach(() => { cleanup(); seenModes.length = 0; });

describe("App shell theme", () => {
  it("pins the shell DevRevThemeProvider to dark", () => {
    render(<App />);
    expect(seenModes).toContain("dark");
    expect(seenModes.every((m) => m === "dark")).toBe(true);
  });
});
