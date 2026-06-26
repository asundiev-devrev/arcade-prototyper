import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory frame source; readFile returns it, writeFile records the new source.
let diskSource = "";
const readFile = vi.fn(async () => diskSource);
const writeFile = vi.fn(async (_p: string, data: string) => { diskSource = data; });
vi.mock("node:fs/promises", () => ({
  default: { readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) },
  readFile: (...a: unknown[]) => readFile(...a),
  writeFile: (...a: unknown[]) => writeFile(...a),
}));
vi.mock("../../../server/paths", () => ({ frameDir: (p: string, f: string) => `/root/projects/${p}/frames/${f}` }));

import { writeBatch, type ElementEdit } from "../../../server/codeWriter/index";

const FILE = "/root/projects/demo/frames/01-x/index.tsx";
function srcWith(jsx: string) {
  return `export default function F() {\n  return (\n    ${jsx}\n  );\n}\n`;
}
function edit(partial: Partial<ElementEdit>): ElementEdit {
  return { file: FILE, line: 3, column: 6, fields: [], ...partial };
}

describe("writeBatch line-delta reporting", () => {
  beforeEach(() => { readFile.mockClear(); writeFile.mockClear(); });

  it("reports lineDelta 0 + editLine for an in-place className swap", async () => {
    diskSource = srcWith(`<div className="text-(--fg-default)">hi</div>`);
    const r = await writeBatch("01-x", [edit({ fields: [{ field: "color", value: "tok:text-(--fg-muted)" }] })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineDelta).toBe(0);
    expect(r.editLine).toBe(3);
  });

  it("reports lineDelta +1 when a text replacement adds a newline", async () => {
    diskSource = srcWith(`<span>Old</span>`);
    // New text contains an embedded newline → written source gains one line.
    const r = await writeBatch("01-x", [edit({ text: "Line one\nLine two", fields: [] })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineDelta).toBe(1);
    expect(r.editLine).toBe(3);
  });

  it("editLine is the min line among the batch's edits", async () => {
    // A wrapper with two child elements on lines 4 and 5; batch lists the
    // higher-line edit FIRST so we prove editLine is the MIN, not the first.
    diskSource =
      `export default function F() {\n  return (\n    <div className="flex">\n` +
      `      <span className="flex">a</span>\n` +
      `      <p className="flex">b</p>\n    </div>\n  );\n}\n`;
    const r = await writeBatch("01-x", [
      edit({ line: 5, column: 7, fields: [{ field: "color", value: "tok:text-(--fg-muted)" }] }),
      edit({ line: 4, column: 7, fields: [{ field: "color", value: "tok:text-(--fg-muted)" }] }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.editLine).toBe(4);
  });
});
