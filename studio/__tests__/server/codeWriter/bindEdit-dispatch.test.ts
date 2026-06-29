import { describe, it, expect } from "vitest";
import { applyEditsToSource } from "../../../server/codeWriter/index";

const FRAME = `const transcript = [
  { id: 1, role: "user", text: "First message" },
];
export default () => <ComputerScene transcript={transcript} />;
`;

describe("applyEditsToSource — bindPath edit", () => {
  it("routes a bindPath text edit to writeBindEdit", () => {
    const r = applyEditsToSource(FRAME, {
      file: "frames/x/index.tsx", line: 1, column: 1,
      bindPath: "transcript[id=1].text", text: "Edited", fields: [],
    } as any);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.source).toContain(`text: "Edited"`); expect(r.source).not.toContain(`"First message"`); }
  });
  it("a non-resolving bindPath fails (agent fallback upstream)", () => {
    const r = applyEditsToSource(FRAME, {
      file: "frames/x/index.tsx", line: 1, column: 1,
      bindPath: "transcript[id=99].text", text: "X", fields: [],
    } as any);
    expect(r.ok).toBe(false);
  });
});
