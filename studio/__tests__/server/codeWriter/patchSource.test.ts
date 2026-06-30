// studio/__tests__/server/codeWriter/patchSource.test.ts
import { describe, it, expect } from "vitest";
import { locateJsx } from "../../../server/codeWriter/locateJsx";
import { readClassName, readTextChild, splice } from "../../../server/codeWriter/patchSource";

function hitFor(src: string, line: number, col: number) {
  const h = locateJsx(src, line, col);
  if (!h) throw new Error("no hit");
  return h;
}

describe("readClassName", () => {
  it("reads a plain string-literal className", () => {
    const src = `const x = <div className="p-4 flex">y</div>;\n`;
    const r = readClassName(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(true);
    expect(r.current).toBe("p-4 flex");
    expect(src.slice(r.valueStart, r.valueEnd)).toBe("p-4 flex");
  });
  it("reads className={\"...\"}", () => {
    const src = `const x = <div className={"p-4"}>y</div>;\n`;
    const r = readClassName(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(true);
    expect(r.current).toBe("p-4");
  });
  it("signals insertion when there is no className", () => {
    const src = `const x = <div>y</div>;\n`;
    const r = readClassName(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(true);
    expect(r.insertAttr).toBe(true);
    expect(r.current).toBe("");
  });
  it("bails on cn() / dynamic className", () => {
    const src = `const x = <div className={cn("p-4", active && "x")}>y</div>;\n`;
    const r = readClassName(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("dynamic-classname");
  });
});

describe("readTextChild", () => {
  it("reads a single text child", () => {
    const src = `const x = <span>Save</span>;\n`;
    const r = readTextChild(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(true);
    expect(src.slice(r.start, r.end)).toBe("Save");
  });
  it("bails on {expr} text", () => {
    const src = `const x = <span>{label}</span>;\n`;
    const r = readTextChild(src, hitFor(src, 1, 12)) as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("dynamic-text");
  });
});

describe("splice", () => {
  it("replaces a range", () => {
    expect(splice("abcdef", 2, 4, "XY")).toBe("abXYef");
  });
});
