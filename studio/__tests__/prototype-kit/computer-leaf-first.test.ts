/**
 * Computer screens are built from design-system LEAVES, not kit wrappers.
 *
 * `ComputerSidebar` and `ChatInput` render furniture nobody asked for — a
 * "New Chat" pill, a history clock, back/forward window chrome, an "Agent Studio"
 * wordmark, a pause glyph in the input — so every generated Computer screen
 * inherited one fixed opinion of the sidebar's contents regardless of the design.
 * They're deprecated in favour of `Sidebar.*` + `ChatComposer`.
 *
 * The deprecation is only real if three things stay true, and all three have
 * already been wrong at some point:
 *   1. the rules must not steer the generator back to the wrappers,
 *   2. the example the generator copies must use the leaves,
 *   3. the wrappers must keep EXISTING (deleting them white-screens old frames).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KIT = join(__dirname, "../../prototype-kit");
const RULES = readFileSync(join(__dirname, "../../templates/CLAUDE.md.tpl"), "utf8");
const EXAMPLE = readFileSync(join(KIT, "examples/ComputerPage.tsx"), "utf8");

describe("Computer screens are leaf-first", () => {
  it("the rules name both wrappers as deprecated", () => {
    expect(RULES).toMatch(/Deprecated: `ComputerSidebar` and `ChatInput`/);
  });

  it("the rules point the sidebar and composer at design-system leaves", () => {
    // The recipe must show the real parts, or the generator has nothing to copy.
    for (const leaf of ["Sidebar.Root", "Sidebar.Section", "Sidebar.HistoryItem", "ChatComposer"]) {
      expect(RULES, `rules should show ${leaf}`).toContain(leaf);
    }
  });

  it("the rules no longer forbid arcade.Sidebar for chat sidebars", () => {
    // This exact sentence is what guaranteed generated screens never reached for
    // the design system's own sidebar.
    expect(RULES).not.toMatch(/\*\*Do NOT use `arcade\.Sidebar` for the main navigation sidebar\*\*/);
  });

  it("the ComputerPage example composes leaves, not the deprecated wrappers", () => {
    expect(EXAMPLE).toContain("Sidebar.Root");
    expect(EXAMPLE).toContain("ChatComposer");
    // USAGE is what teaches the old shape — an import or a JSX tag. The example's
    // prose deliberately names both wrappers to explain why they're absent, so
    // match on code, not on the words appearing anywhere in the file.
    expect(EXAMPLE).not.toMatch(/import[^;]*\b(ComputerSidebar|ChatInput)\b[^;]*;/s);
    expect(EXAMPLE).not.toMatch(/<\/?(ComputerSidebar|ChatInput)\b/);
  });

  it("the example shows a bubble tail (it defaults to off)", () => {
    // Without `tail` a transcript renders as floating rectangles with no tails —
    // the props table alone never got the generator to pass it.
    expect(EXAMPLE).toMatch(/<ChatBubble[^>]*\stail\b/);
  });

  it("keeps the deprecated wrappers exported so existing frames still render", () => {
    // Deleting them would resolve to `undefined` at runtime = white screen, with
    // no build error to catch it.
    const barrel = readFileSync(join(KIT, "index.ts"), "utf8");
    expect(barrel).toMatch(/ComputerSidebar/);
    expect(barrel).toMatch(/ChatInput/);
  });

  it("marks both wrapper sources DEPRECATED", () => {
    for (const f of ["composites/ComputerSidebar.tsx", "composites/ChatInput.tsx"]) {
      expect(readFileSync(join(KIT, f), "utf8"), `${f} should say DEPRECATED`).toMatch(/DEPRECATED/);
    }
  });
});
