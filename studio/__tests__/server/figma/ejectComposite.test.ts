// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transform } from "esbuild";
import { rewriteCompositeSource, ejectComposite } from "../../../server/figma/ejectComposite";

describe("rewriteCompositeSource", () => {
  it("collapses relative composite + template imports to arcade-prototypes", () => {
    const out = rewriteCompositeSource(
      `import { ChatInput } from "./ChatInput.js";\n` +
      `import { ComputerPage } from "../templates/ComputerPage.js";\n`,
    );
    expect(out).toContain(`from "arcade-prototypes"`);
    expect(out).not.toMatch(/\.\/ChatInput\.js/);
    expect(out).not.toMatch(/\.\.\/templates\/ComputerPage\.js/);
  });

  it("rewrites @xorkavi/arcade-gen to arcade/components", () => {
    const out = rewriteCompositeSource(`import { IconButton } from "@xorkavi/arcade-gen";`);
    expect(out).toContain(`from "arcade/components"`);
    expect(out).not.toContain("@xorkavi/arcade-gen");
  });

  it("preserves an 'as' alias", () => {
    const out = rewriteCompositeSource(`import { Document as DocumentIcon } from "@xorkavi/arcade-gen";`);
    expect(out).toContain("Document as DocumentIcon");
  });

  it("preserves a type-only import qualifier", () => {
    const out = rewriteCompositeSource(`import type { CanvasTab } from "./CanvasTabs.js";`);
    expect(out).toMatch(/import type \{ CanvasTab \} from "arcade-prototypes"/);
  });

  it("leaves react + arcade-prototypes barrel imports untouched", () => {
    const src = `import * as React from "react";\nimport { X } from "arcade-prototypes";`;
    expect(rewriteCompositeSource(src)).toBe(src);
  });
});

describe("ejectComposite", () => {
  let dir: string;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it("writes an import-rewritten copy of ComputerScene with no relative/.js or arcade-gen specifiers", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eject-"));
    const written = await ejectComposite("ComputerScene", dir);
    expect(written).toBe(path.join(dir, "ComputerScene.tsx"));
    const out = fs.readFileSync(written, "utf8");
    expect(out).not.toMatch(/from "\.\.?\/.*\.js"/);   // no relative .js imports
    expect(out).not.toContain("@xorkavi/arcade-gen");
    expect(out).toContain(`from "arcade-prototypes"`);
    // alias survived (ComputerScene imports Document as DocumentIcon)
    expect(out).toContain("Document as DocumentIcon");
  });

  it("throws on an unknown composite name", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eject-"));
    await expect(ejectComposite("NopeScene", dir)).rejects.toThrow();
  });
});

describe("ejected ComputerScene is frame-legal and compiles", () => {
  it("has only frame-legal import specifiers (react / arcade / arcade-prototypes)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eject-legal-"));
    try {
      const out = fs.readFileSync(await ejectComposite("ComputerScene", dir), "utf8");
      const specifiers = [...out.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      const ALLOWED = new Set(["react", "arcade", "arcade/components", "arcade-prototypes"]);
      const illegal = specifiers.filter((s) => !ALLOWED.has(s));
      expect(illegal).toEqual([]);   // no ./*.js, no @xorkavi/arcade-gen left behind
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the rewritten source compiles (syntax valid after rewrite)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eject-compile-"));
    try {
      const out = fs.readFileSync(await ejectComposite("ComputerScene", dir), "utf8");
      // esbuild strips types + verifies syntax; loader tsx handles JSX. Throws on bad syntax.
      const res = await transform(out, { loader: "tsx", jsx: "automatic" });
      expect(res.code.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
