import { describe, it, expect, vi, beforeEach } from "vitest";
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

// In-memory fs mocks for writeBatch end-to-end test (same approach as writeBatch-delta.test.ts)
let diskSource = "";
const readFile = vi.fn(async () => diskSource);
const writeFile = vi.fn(async (_p: string, data: string) => { diskSource = data; });
vi.mock("node:fs/promises", () => ({
  default: { readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) },
  readFile: (...a: unknown[]) => readFile(...a),
  writeFile: (...a: unknown[]) => writeFile(...a),
}));
vi.mock("../../../server/paths", () => ({ frameDir: (p: string, f: string) => `/root/projects/${p}/frames/${f}` }));

import { writeBatch } from "../../../server/codeWriter/index";

describe("writeBatch with bindPath (end-to-end, the REAL entry point)", () => {
  beforeEach(() => { diskSource = ""; readFile.mockClear(); writeFile.mockClear(); });

  it("accepts an explicit projectSlug and writes a bind edit to disk", async () => {
    diskSource = FRAME;
    const r = await writeBatch("01-computer", [
      { file: "", line: 0, column: 0, bindPath: "transcript[id=1].text", text: "Edited", fields: [] },
    ], "demo");
    expect(r.ok).toBe(true);
    expect(diskSource).toContain(`text: "Edited"`);
    expect(diskSource).not.toContain(`"First message"`);
  });

  it("a bind edit with no projectSlug param and file:'' returns unresolved-project", async () => {
    diskSource = FRAME;
    const r = await writeBatch("01-computer", [
      { file: "", line: 0, column: 0, bindPath: "transcript[id=1].text", text: "Edited", fields: [] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unresolved-project");
  });

  it("a normal JSX edit still resolves via the file regex when projectSlug is omitted (backward compat)", async () => {
    diskSource = `export default function F() { return <div className="text-(--fg-default)">hi</div>; }`;
    const r = await writeBatch("01-x", [
      { file: "/root/projects/demo/frames/01-x/index.tsx", line: 1, column: 40, fields: [{ field: "color", value: "tok:text-(--fg-muted)" }] },
    ]);
    expect(r.ok).toBe(true);
    expect(diskSource).toContain("text-(--fg-muted)");
  });
});
