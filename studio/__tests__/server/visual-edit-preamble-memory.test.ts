// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "lib",
  "visualEditPreamble.ts",
);

describe("visual-edit preamble", () => {
  const src = fs.readFileSync(SRC, "utf-8");

  it("exempts the memory directory from the other-files prohibition", () => {
    expect(src).toMatch(/memory\//);
  });

  it("still scopes edits to the identified element", () => {
    expect(src).toContain("Apply each change ONLY to the element identified");
  });
});
