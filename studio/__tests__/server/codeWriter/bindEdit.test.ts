// studio/__tests__/server/codeWriter/bindEdit.test.ts
import { describe, it, expect } from "vitest";
import { parseBindPath, writeBindEdit } from "../../../server/codeWriter/bindEdit";

const FRAME = `import { ComputerScene } from "arcade-prototypes";
const transcript = [
  { id: 1, role: "user", text: "First message" },
  { id: 2, role: "assistant", text: "Second message", artefact: { tag: "DOC", title: "Brief" } },
];
export default function F() {
  return <ComputerScene transcript={transcript} />;
}
`;

describe("parseBindPath", () => {
  it("parses a text path", () => {
    expect(parseBindPath("transcript[id=2].text")).toEqual({ array: "transcript", id: 2, field: ["text"] });
  });
  it("parses a nested path", () => {
    expect(parseBindPath("transcript[id=2].artefact.title")).toEqual({ array: "transcript", id: 2, field: ["artefact", "title"] });
  });
  it("rejects malformed", () => {
    expect(parseBindPath("garbage")).toBeNull();
    expect(parseBindPath("transcript[2].text")).toBeNull();
  });
});

describe("writeBindEdit", () => {
  it("edits a message's text by id (not position)", () => {
    const r = writeBindEdit(FRAME, "transcript[id=1].text", "Edited first");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain(`text: "Edited first"`);
      expect(r.source).not.toContain(`text: "First message"`);
      expect(r.source).toContain(`text: "Second message"`); // untouched
    }
  });
  it("edits a nested artefact title", () => {
    const r = writeBindEdit(FRAME, "transcript[id=2].artefact.title", "New Brief");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`title: "New Brief"`);
  });
  it("addresses by id after a reorder (id, not index)", () => {
    const reordered = FRAME.replace(
      /const transcript = \[[\s\S]*?\];/,
      `const transcript = [\n  { id: 2, role: "assistant", text: "Second message" },\n  { id: 1, role: "user", text: "First message" },\n];`,
    );
    const r = writeBindEdit(reordered, "transcript[id=1].text", "Edited first");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`text: "Edited first"`);
  });
  it("fails on a missing id", () => {
    expect(writeBindEdit(FRAME, "transcript[id=99].text", "x").ok).toBe(false);
  });
  it("fails on a missing field", () => {
    expect(writeBindEdit(FRAME, "transcript[id=1].nope", "x").ok).toBe(false);
  });
  it("fails when there is no transcript array (bare frame)", () => {
    const bare = `export default () => <ComputerScene />;`;
    expect(writeBindEdit(bare, "transcript[id=1].text", "x").ok).toBe(false);
  });
  it("escapes the value so a quote can't break parse", () => {
    const r = writeBindEdit(FRAME, "transcript[id=1].text", 'He said "hi"');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ts = require("typescript");
      const sf = ts.createSourceFile("f.tsx", r.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      expect((sf as any).parseDiagnostics?.length ?? 0).toBe(0);
    }
  });

  it("unwraps as-const wrapper (the confirmed root-cause bug)", () => {
    const asConstFrame = `import { ComputerScene } from "arcade-prototypes";
const transcript = [
  { id: 1, role: "user", text: "A" },
] as const;
export default function F() {
  return <ComputerScene transcript={transcript} />;
}
`;
    const r = writeBindEdit(asConstFrame, "transcript[id=1].text", "B");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`text: "B"`);
  });

  it("unwraps satisfies wrapper", () => {
    const satisfiesFrame = `import { ComputerScene } from "arcade-prototypes";
type Message = any;
const transcript = [
  { id: 1, role: "user", text: "A" },
] satisfies Message[];
export default function F() {
  return <ComputerScene transcript={transcript} />;
}
`;
    const r = writeBindEdit(satisfiesFrame, "transcript[id=1].text", "B");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`text: "B"`);
  });

  it("unwraps parenthesized wrapper", () => {
    const parenFrame = `import { ComputerScene } from "arcade-prototypes";
const transcript = ([
  { id: 1, role: "user", text: "A" },
]);
export default function F() {
  return <ComputerScene transcript={transcript} />;
}
`;
    const r = writeBindEdit(parenFrame, "transcript[id=1].text", "B");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`text: "B"`);
  });
});
