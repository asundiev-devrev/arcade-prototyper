import { describe, it, expect } from "vitest";
import path from "node:path";
import { suppressFrameHmrPlugin } from "../../../server/plugins/suppressFrameHmrPlugin";
import { projectsRoot } from "../../../server/paths";

// Vite composes hotUpdate as an ObjectHook (function OR { handler }). Resolve
// the handler the same way Vite core does so the test drives the real code
// path regardless of which form the plugin uses.
function getHandler(hook: any): (opts: any) => any {
  return typeof hook === "object" && hook !== null ? hook.handler : hook;
}

// Minimal fake HotUpdateOptions — the plugin only reads `file`. `modules: []`
// mirrors the shape Vite passes; `type`/`timestamp` fill the interface.
function ctx(file: string) {
  return {
    type: "update" as const,
    file,
    timestamp: Date.now(),
    modules: [] as any[],
    read: async () => "",
    server: {} as any,
  };
}

const abs = (...segs: string[]) => path.join(projectsRoot(), ...segs);

describe("suppressFrameHmrPlugin hotUpdate", () => {
  const handler = getHandler(suppressFrameHmrPlugin().hotUpdate);

  it("suppresses HMR for a frame index.tsx (returns [])", () => {
    expect(handler(ctx(abs("proj", "frames", "01-frame", "index.tsx")))).toEqual([]);
  });

  it("suppresses HMR for an ejected sibling module (returns [])", () => {
    expect(handler(ctx(abs("proj", "frames", "01-frame", "ComputerScene.tsx")))).toEqual([]);
  });

  it("suppresses HMR for a plain .ts frame-dir module (returns [])", () => {
    expect(handler(ctx(abs("proj", "frames", "01-frame", "data.ts")))).toEqual([]);
  });

  it("does NOT suppress theme-overrides.css (returns undefined)", () => {
    expect(handler(ctx(abs("proj", "theme-overrides.css")))).toBeUndefined();
  });

  it("does NOT suppress a shared module (returns undefined)", () => {
    expect(handler(ctx(abs("proj", "shared", "devrev.ts")))).toBeUndefined();
  });

  it("SUPPRESSES a nested code module under the frame dir (pages/Skills.tsx)", () => {
    // Real frames eject nested code (frames/<id>/pages/*.tsx). A broken edit to
    // one must route through the resilient reload path like index.tsx — else
    // Vite Fast-Refresh hot-swaps it into the visible iframe (white screen).
    expect(handler(ctx(abs("proj", "frames", "01-frame", "pages", "Skills.tsx")))).toEqual([]);
    expect(handler(ctx(abs("proj", "frames", "01-frame", "components", "Row.ts")))).toEqual([]);
  });

  it("does NOT suppress a nested ASSET (frames/<id>/assets/* is copied, not imported code)", () => {
    // assets/ holds images/svgs the frame references by URL, not modules Vite
    // hot-swaps — keep them out of the frame-source reload/suppress path.
    expect(handler(ctx(abs("proj", "frames", "01-frame", "assets", "icon.svg")))).toBeUndefined();
    expect(handler(ctx(abs("proj", "frames", "01-frame", "assets", "icon.tsx")))).toBeUndefined();
  });

  it("does NOT suppress a studio shell source file (returns undefined)", () => {
    const shellPath = path.resolve(__dirname, "../../../src/components/viewport/FrameCard.tsx");
    expect(handler(ctx(shellPath))).toBeUndefined();
  });
});
