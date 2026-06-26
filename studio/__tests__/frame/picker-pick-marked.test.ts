import { describe, it, expect, beforeEach, vi } from "vitest";

// The picker resolves fibers via getFiberFromNode (React internals). For this
// test we stub a fiber on the marked node so resolveSelection can run, and
// assert a frame-picked message is posted for the marked element.
// NOTE: picker.ts attaches a window 'message' listener at import time; we drive
// it by dispatching a MessageEvent and capturing window.parent.postMessage.

describe("picker pick-marked re-selection", () => {
  let posts: any[];
  beforeEach(() => {
    document.documentElement.innerHTML = "";
    posts = [];
    (window as any).parent = { postMessage: (m: any) => posts.push(m) };
  });

  it("posts frame-picked for the node carrying the marker token", async () => {
    await import("../../src/frame/picker");
    const el = document.createElement("div");
    el.setAttribute("data-arcade-customized", "cz-abc");
    el.textContent = "hi";
    document.body.appendChild(el);
    // Stamp a minimal React fiber the picker's getFiberFromNode can read.
    // (Mirror how picker-owner-chain stubs fibers: a __reactFiber$ key with a
    //  _debugStack that parses to a user file.)
    const STACK = "    at Demo (http://localhost/projects/p/frames/01-x/index.tsx?v=1:3:5)";
    (el as any).__reactFiber$test = {
      type: Object.assign(() => null, { displayName: "Demo" }),
      _debugStack: { stack: STACK },
      return: null,
    };

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:pick-marked", token: "cz-abc" },
    }));

    const picked = posts.find((m) => m?.type === "arcade-studio:frame-picked");
    expect(picked).toBeDefined();
  });

  it("posts nothing when no node carries the token", async () => {
    await import("../../src/frame/picker");
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:pick-marked", token: "cz-missing" },
    }));
    expect(posts.find((m) => m?.type === "arcade-studio:frame-picked")).toBeUndefined();
  });
});
