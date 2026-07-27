// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// inventory.ts is imported by projects.ts and chat.ts, which dozens of tests
// load under jsdom. A static componentStore import drags in esbuild, which
// cannot initialise under jsdom — that took out 12 test files once already.
describe("inventory module graph", () => {
  it("imports under jsdom without pulling in esbuild", async () => {
    const mod = await import("../../server/inventory");
    expect(typeof mod.renderInventory).toBe("function");
    expect(typeof mod.writeInventory).toBe("function");
  });
});
