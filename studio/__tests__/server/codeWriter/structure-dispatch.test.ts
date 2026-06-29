import { describe, it, expect } from "vitest";
import { applyEditsToSource } from "../../../server/codeWriter/index";

const FRAME = `const transcript = [
  { id: 1, role: "user", text: "First" },
];
export default () => <ComputerScene transcript={transcript} />;
`;

describe("applyEditsToSource — structureOp", () => {
  it("routes an insert structureOp to writeBindStructure", () => {
    const r = applyEditsToSource(FRAME, {
      file: "", line: 0, column: 0, fields: [],
      arrayName: "transcript",
      structureOp: { kind: "insert", afterId: 1, entry: { role: "assistant", text: "Reply" } },
    } as any);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.source).toContain(`text: "Reply"`); expect(r.source).toContain(`id: 2`); }
  });
  it("a structureOp with a bad id fails (agent fallback upstream)", () => {
    const r = applyEditsToSource(FRAME, {
      file: "", line: 0, column: 0, fields: [],
      arrayName: "transcript",
      structureOp: { kind: "delete", id: 99 },
    } as any);
    expect(r.ok).toBe(false);
  });
});
