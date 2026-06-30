import { describe, it, expect } from "vitest";
import { buildOwnerChain } from "../../src/frame/picker";

// A fake fiber chain: leaf div (no name) → Agent (kit) → ComputerScene (frame).
// Each named fiber exposes a _debugStack whose top user frame is a known file.
function f(name: string | null, stackTop: string | null, ret: any): any {
  return {
    type: name ? Object.assign(() => null, { displayName: name }) : "div",
    _debugStack: stackTop ? { stack: stackTop } : undefined,
    return: ret,
  };
}
const FRAME = "    at ComputerScene (http://localhost/projects/demo/frames/01-x/index.tsx?v=1:6:5)";
const KIT = "    at Agent (http://localhost/prototype-kit/dist/composites/ChatMessages.js:480:9)";

describe("buildOwnerChain", () => {
  it("collects each named owner with its call-site, innermost first", () => {
    const scene = f("ComputerScene", FRAME, null);
    const agent = f("Agent", KIT, scene);
    const leaf = f(null, null, agent);
    const chain = buildOwnerChain(leaf);
    expect(chain.map((l) => l.componentName)).toEqual(["Agent", "ComputerScene"]);
    expect(chain[1].file).toContain("/frames/01-x/index.tsx");
    expect(chain[1].line).toBe(6);
    expect(chain[1].column).toBe(5);
  });
});
