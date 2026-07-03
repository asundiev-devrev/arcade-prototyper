// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const tpl = fs.readFileSync(
  path.resolve(__dirname, "../../templates/CLAUDE.md.tpl"),
  "utf8",
);

describe("CLAUDE.md.tpl token-class syntax", () => {
  it("shows the paren class form and marks the named form as wrong", () => {
    // Colors use text-(--fg-*), NOT text-fg-*. Pin both so a rewrite can't
    // silently drop the syntax (the unstyled-frame bug).
    expect(tpl).toMatch(/text-\(--fg-neutral-prominent\)/);
    expect(tpl).toMatch(/bg-\(--surface-shallow\)/);
    // Warns the named form compiles to nothing.
    expect(tpl).toMatch(/text-fg-neutral/); // the ✗ example
    expect(tpl).toMatch(/compile to nothing|renders? no|does not render/i);
  });
  it("clarifies typography stays a named utility", () => {
    expect(tpl).toMatch(/text-body-small/);
  });
});
