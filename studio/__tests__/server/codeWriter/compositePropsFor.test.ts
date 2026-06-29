// studio/__tests__/server/codeWriter/compositePropsFor.test.ts
import { describe, it, expect } from "vitest";
import { compositePropsFor } from "../../../server/codeWriter/kitProps";

describe("compositePropsFor (reads real prototype-kit source)", () => {
  it("surfaces ComputerScene's scalar props from composites/ComputerScene.tsx", () => {
    const props = compositePropsFor("ComputerScene");
    const by = (n: string) => props.find((p) => p.name === n);
    expect(by("state")).toMatchObject({ kind: "select", values: ["empty", "streaming", "transcript"] });
    expect(by("withCanvasPanel")).toMatchObject({ kind: "toggle" });
    expect(by("userName")).toMatchObject({ kind: "text", default: "Ava Wright" });
    expect(by("chatInputPlaceholder")).toMatchObject({ kind: "text", default: "Ask me anything" });
    // skipped surfaces
    expect(by("headerTitle")).toBeUndefined();
    expect(by("activeSessionId")).toBeUndefined();
    expect(by("sessions")).toBeUndefined();
  });
  it("returns [] for an unknown / non-composite name", () => {
    expect(compositePropsFor("NotARealComposite")).toEqual([]);
  });
  it("rejects a non-conforming name (closed-world)", () => {
    expect(compositePropsFor("../../etc/passwd")).toEqual([]);
  });
});
