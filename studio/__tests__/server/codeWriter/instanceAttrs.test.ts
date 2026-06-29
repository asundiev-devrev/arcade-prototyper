import { describe, it, expect } from "vitest";
import { readInstanceAttrs } from "../../../server/codeWriter/instanceAttrs";

const SRC = `export default function F() {\n  return <ComputerScene userName="Ada" withCanvasPanel={true} count={3} bare />;\n}\n`;

describe("readInstanceAttrs", () => {
  it("returns set attrs as display strings", () => {
    const a = readInstanceAttrs(SRC, 2, 11); // tag-name col of <ComputerScene
    expect(a.userName).toBe("Ada");
    expect(a.withCanvasPanel).toBe("true");
    expect(a.count).toBe("3");
    expect(a.bare).toBe("true");
  });
  it("returns {} when nothing matches", () => {
    expect(readInstanceAttrs(SRC, 99, 1)).toEqual({});
  });
});
