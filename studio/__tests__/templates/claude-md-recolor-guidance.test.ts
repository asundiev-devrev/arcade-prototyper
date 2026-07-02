// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const tpl = fs.readFileSync(
  path.resolve(__dirname, "../../templates/CLAUDE.md.tpl"),
  "utf8",
);

describe("CLAUDE.md.tpl recolor + eject guidance", () => {
  it("mandates a mode-scoped override selector, not a bare :root (review B1)", () => {
    // The kit defines tokens under `:root, :root.light` (specificity 0,2,0);
    // a bare :root override (0,1,0) loses. Pin the correct selector shape.
    expect(tpl).toMatch(/:root\.light/);
    expect(tpl).toMatch(/theme-overrides\.css/);
    // Warns explicitly that a bare :root override is defeated by the cascade.
    expect(tpl).toMatch(/bare `?:root`?|:root alone|loses the cascade|specificity/i);
  });

  it("lists the semantic surface + fg tokens to override, and warns off core primitives", () => {
    expect(tpl).toMatch(/--surface-backdrop/);
    expect(tpl).toMatch(/--surface-shallow/);
    expect(tpl).toMatch(/--surface-overlay/);
    expect(tpl).toMatch(/--fg-neutral-prominent/);
    expect(tpl).toMatch(/--core-neutrals/);   // mentioned as "do NOT override"
  });

  it("explains full-canvas input goes in the body slot, not the chatInput slot (review S2)", () => {
    expect(tpl).toMatch(/full-canvas|full-screen input/i);
    expect(tpl).toMatch(/body \(?children\)? slot|children slot/i);
  });

  it("documents eject-to-source: local copy is editable, sealed kit source is not", () => {
    expect(tpl).toMatch(/\.eject|eject/i);
    expect(tpl).toMatch(/import .* from "\.\//);   // local import guidance
  });
});
