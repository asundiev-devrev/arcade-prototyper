// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import {
  detectComponentPropViolations,
  kitComponentOf,
} from "../../../server/hooks/validateComponentProps.mjs";

const V = (src: string): number => detectComponentPropViolations(src).length;

describe("detectComponentPropViolations — positives (must flag)", () => {
  it("flags Select.Root multiple", () => {
    expect(V(`<Select.Root multiple><Select.Item value="a"/></Select.Root>`)).toBeGreaterThan(0);
  });
  it("flags array defaultValue on Select.Root", () => {
    expect(V(`<Select.Root defaultValue={["a"]} />`)).toBeGreaterThan(0);
  });
  it("flags array value on Select.Root", () => {
    expect(V(`<Select.Root value={["a","b"]} />`)).toBeGreaterThan(0);
  });
  it("flags array defaultValue on Tabs.Root (string-only)", () => {
    expect(V(`<Tabs.Root defaultValue={["one"]} />`)).toBeGreaterThan(0);
  });
  it("flags Tabs.Root multiple", () => {
    expect(V(`<Tabs.Root multiple />`)).toBeGreaterThan(0);
  });
  it("flags ToggleGroup.Root multiple (use type= instead)", () => {
    expect(V(`<ToggleGroup.Root multiple />`)).toBeGreaterThan(0);
  });
  it("flags array defaultValue on ToggleGroup.Root type='single'", () => {
    expect(V(`<ToggleGroup.Root type="single" defaultValue={["a","b"]} />`)).toBeGreaterThan(0);
  });
  it("flags array defaultValue on ToggleGroup.Root with type ABSENT", () => {
    expect(V(`<ToggleGroup.Root defaultValue={["a","b"]} />`)).toBeGreaterThan(0);
  });
});

describe("detectComponentPropViolations — exemptions (must NOT flag)", () => {
  it("does NOT flag a valid string defaultValue Select", () => {
    expect(V(`<Select.Root defaultValue="a" />`)).toBe(0);
  });
  it("does NOT flag a valid string value Select", () => {
    expect(V(`<Select.Root value="a" onValueChange={f} />`)).toBe(0);
  });
  it("does NOT flag native <select multiple> (lowercase HTML)", () => {
    expect(V(`<select multiple><option/></select>`)).toBe(0);
  });
  it("does NOT flag native <input multiple>", () => {
    expect(V(`<input type="file" multiple />`)).toBe(0);
  });
  it("does NOT flag a valid multi-toggle ToggleGroup type='multiple' with array", () => {
    expect(V(`<ToggleGroup.Root type="multiple" defaultValue={["a","b"]} />`)).toBe(0);
  });
  it("does NOT flag ToggleGroup type='multiple' value array", () => {
    expect(V(`<ToggleGroup.Root type="multiple" value={["a"]} />`)).toBe(0);
  });
  it("does NOT flag a DYNAMIC type (may resolve to multiple)", () => {
    expect(V(`<ToggleGroup.Root type={mode} defaultValue={["a","b"]} />`)).toBe(0);
  });
  it("does NOT flag ToggleGroup type='single' with a string defaultValue", () => {
    expect(V(`<ToggleGroup.Root type="single" defaultValue="a" />`)).toBe(0);
  });
  it("does NOT flag unrelated components", () => {
    expect(V(`<Button multiple /><Card value={["a"]} />`)).toBe(0);
  });
  // Non-array-LITERAL value/defaultValue must NOT flag — only array literals
  // are provably wrong-shaped. A variable / call / conditional may resolve to
  // a valid string. (The "false alarms NOT OK" class — guard against a
  // regression that starts flagging dynamic expressions.)
  it("does NOT flag a variable defaultValue on Select", () => {
    expect(V(`<Select.Root defaultValue={vals} />`)).toBe(0);
  });
  it("does NOT flag a call-expression value on Select", () => {
    expect(V(`<Select.Root value={getDefault()} />`)).toBe(0);
  });
  it("does NOT flag a conditional defaultValue on Select", () => {
    expect(V(`<Select.Root defaultValue={cond ? "a" : "b"} />`)).toBe(0);
  });
  it("returns [] on parse of non-JSX", () => {
    expect(V(`const x = 1;`)).toBe(0);
  });
  it("returns [] on empty / non-string", () => {
    expect(V(``)).toBe(0);
    // @ts-expect-error — deliberately wrong type
    expect(detectComponentPropViolations(null).length).toBe(0);
  });
});

describe("kitComponentOf", () => {
  it("maps a JSX member tag to its root component name via a real parse", () => {
    // Parse `<Select.Root/>` and hand the tagName to kitComponentOf.
    // (Direct unit check that native lowercase tags yield null.)
    const ts = require("typescript");
    const sf = ts.createSourceFile("t.tsx", `<Select.Root/>;\n<select/>;`, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    const tags: unknown[] = [];
    const walk = (n: any) => {
      if (ts.isJsxSelfClosingElement(n)) tags.push(kitComponentOf(n.tagName));
      ts.forEachChild(n, walk);
    };
    walk(sf);
    expect(tags).toContain("Select");
    expect(tags).toContain(null); // native <select> → not a kit component
  });
});

// ---- Integration: exit codes through the real hook binary ----

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, "../../../server/hooks/validateComponentProps.mjs");

function runHook(payload: unknown) {
  return spawnSync("node", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env },
    encoding: "utf-8",
  });
}

function tmpFrame(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-props-hook-"));
  const filePath = path.join(tmpDir, "test-frame.tsx");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("validateComponentProps hook (integration)", () => {
  it("exits 2 on Write of <Select.Root multiple>", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: { file_path: "/tmp/frame.tsx", content: `export default () => <Select.Root multiple />;` },
    });
    expect(proc.status).toBe(2);
    expect(proc.stderr).toContain("multiple");
  });

  it("exits 0 on a valid string-defaultValue Select", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: { file_path: "/tmp/frame.tsx", content: `export default () => <Select.Root defaultValue="a" />;` },
    });
    expect(proc.status).toBe(0);
  });

  it("exits 0 for a non-.tsx file even with a violation in content", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: { file_path: "/tmp/foo.css", content: `<Select.Root multiple />` },
    });
    expect(proc.status).toBe(0);
  });

  it("reads the post-edit file from disk on Edit and exits 2", () => {
    const file = tmpFrame(`export default () => <Select.Root multiple defaultValue={["x"]} />;`);
    const proc = runHook({
      tool_name: "Edit",
      tool_input: { file_path: file, old_string: "multiple", new_string: "multiple" },
    });
    expect(proc.status).toBe(2);
  });

  it("exits 0 on a valid multi-toggle through the binary", () => {
    const file = tmpFrame(`export default () => <ToggleGroup.Root type="multiple" defaultValue={["a","b"]} />;`);
    const proc = runHook({
      tool_name: "Write",
      tool_input: { file_path: file, content: fs.readFileSync(file, "utf-8") },
    });
    expect(proc.status).toBe(0);
  });
});
