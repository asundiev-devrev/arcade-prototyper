// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Pin the token-guidance section in CLAUDE.md.tpl. Beta-user Nuska reported
// (0.23.3) that the agent kept reaching for `--expressive-intelligence` (a
// hallucination) instead of `--bg-intelligence-prominent`, and that
// `--surface-shallow` looked white in some renders. The 0.23.4 fix lives in
// this template — these tests fail loudly if the guidance is removed or
// drifts out of date.
const tpl = fs.readFileSync(
  path.resolve(__dirname, "../../templates/CLAUDE.md.tpl"),
  "utf8",
);

describe("CLAUDE.md.tpl token guidance", () => {
  it("warns against the --expressive-intelligence hallucination", () => {
    expect(tpl).toMatch(/--expressive-intelligence/);
  });

  it("lists the canonical violet intelligence tokens", () => {
    // Every consumer needs at least the prominent fill + the on-prominent
    // foreground to draw a usable AI/agent badge.
    expect(tpl).toMatch(/--bg-intelligence-prominent/);
    expect(tpl).toMatch(/--bg-intelligence-medium/);
    expect(tpl).toMatch(/--bg-intelligence-subtle/);
    expect(tpl).toMatch(/--fg-intelligence-prominent/);
    expect(tpl).toMatch(/--fg-intelligence-on-prominent/);
  });

  it("clarifies that --surface-shallow is the sidebar/rail color, not white", () => {
    expect(tpl).toMatch(/--surface-shallow/);
    // The phrasing is what the agent actually reads — pin a marker phrase so
    // a future rewrite doesn't drop the "looks white" hint silently.
    expect(tpl.toLowerCase()).toMatch(/sidebar|rail/);
  });
});
