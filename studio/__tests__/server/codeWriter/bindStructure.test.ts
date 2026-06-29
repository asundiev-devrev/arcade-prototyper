import { describe, it, expect } from "vitest";
import ts from "typescript";
import { writeBindStructure } from "../../../server/codeWriter/bindStructure";

function reparses(src: string): boolean {
  const sf = ts.createSourceFile("f.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ((sf as any).parseDiagnostics?.length ?? 0) === 0;
}

// Multi-line, trailing comma on every element (real generated-frame shape).
const MULTI = `const transcript = [
  { id: 1, role: "user", text: "First" },
  { id: 2, role: "assistant", text: "Second", artefact: { tag: "DOC", title: "Brief" } },
];
`;
// Single-line + as const (real seed shape), no trailing comma on last.
const SEED = `const transcript = [{ id: 1, role: "user", text: "Hi" }, { id: 2, role: "assistant", text: "Yo" }] as const;`;

describe("writeBindStructure — insert", () => {
  it("inserts after a given id with a fresh max+1 id, matching multi-line format", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "insert", afterId: 1, entry: { role: "user", text: "New" } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(reparses(r.source)).toBe(true);
      expect(r.source).toContain(`text: "New"`);
      expect(r.source).toContain(`id: 3`);            // max(1,2)+1
      // new entry sits between id 1 and id 2
      expect(r.source.indexOf(`"First"`)).toBeLessThan(r.source.indexOf(`"New"`));
      expect(r.source.indexOf(`"New"`)).toBeLessThan(r.source.indexOf(`"Second"`));
      // multi-line format preserved: the new entry is on its own line
      expect(r.source).toMatch(/\n\s+\{ id: 3,[^\n]*"New"[^\n]*\},?\n/);
    }
  });
  it("inserts at end when afterId is null", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "insert", afterId: null, entry: { role: "assistant", text: "Last" } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source.indexOf(`"Second"`)).toBeLessThan(r.source.indexOf(`"Last"`)); }
  });
  it("inserts into the single-line as-const seed and still reparses", () => {
    const r = writeBindStructure(SEED, "transcript", { kind: "insert", afterId: 1, entry: { role: "user", text: "Mid" } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source).toContain(`text: "Mid"`); expect(r.source).toContain(`id: 3`); }
  });
  it("computes id from a Date.now()-sized max", () => {
    const big = `const transcript = [\n  { id: 1717000000000, role: "user", text: "x" },\n];\n`;
    const r = writeBindStructure(big, "transcript", { kind: "insert", afterId: null, entry: { role: "user", text: "y" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`id: 1717000000001`);
  });
  it("escapes quotes in the new text", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "insert", afterId: 1, entry: { role: "user", text: `He said "hi"` } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(reparses(r.source)).toBe(true);
  });
});

describe("writeBindStructure — delete / move / setRole", () => {
  it("deletes an entry, leaving others + ids intact, reparse-clean", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "delete", id: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source).not.toContain(`"First"`); expect(r.source).toContain(`"Second"`); expect(r.source).toContain(`id: 2`); }
  });
  it("deletes the LAST entry without leaving a dangling/double comma", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "delete", id: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source).not.toContain(`"Second"`); }
  });
  it("moves an entry before another id, ids intact", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "move", id: 2, beforeId: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(reparses(r.source)).toBe(true); expect(r.source.indexOf(`"Second"`)).toBeLessThan(r.source.indexOf(`"First"`)); }
  });
  it("setRole flips role and strips artefact when going to user (cosmetic hygiene)", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "setRole", id: 2, role: "user" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(reparses(r.source)).toBe(true);
      expect(r.source).toMatch(/\{ id: 2, role: "user", text: "Second"[^}]*\}/);
      expect(r.source).not.toContain(`title: "Brief"`); // artefact stripped
    }
  });
  it("setRole user→assistant leaves text intact", () => {
    const r = writeBindStructure(MULTI, "transcript", { kind: "setRole", id: 1, role: "assistant" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toMatch(/\{ id: 1, role: "assistant", text: "First"/);
  });
});

describe("writeBindStructure — failures (graceful)", () => {
  it("missing id → {ok:false}", () => {
    expect(writeBindStructure(MULTI, "transcript", { kind: "delete", id: 99 }).ok).toBe(false);
    expect(writeBindStructure(MULTI, "transcript", { kind: "move", id: 99, beforeId: 1 }).ok).toBe(false);
    expect(writeBindStructure(MULTI, "transcript", { kind: "setRole", id: 99, role: "user" }).ok).toBe(false);
  });
  it("absent array → {ok:false}, no throw", () => {
    expect(writeBindStructure(`export default () => null;`, "transcript", { kind: "delete", id: 1 }).ok).toBe(false);
  });
});
