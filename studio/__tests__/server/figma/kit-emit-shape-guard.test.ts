/**
 * Mapping guards: a name match is not enough, and never invent a visual.
 *
 * From one real import (Figma 5484:36257) where the screen looked wrong in four
 * places, none of them layout:
 *   - a 216x40 wordmark pill matched `Button`, went down the labelless→IconButton
 *     downgrade, and blew one letter of "computer" up to fill the pill;
 *   - a 28x28 search button matched `Select` and rendered the words "Select…";
 *   - 17 avatars that Figma paints EMPTY came out as visible glyphs, because the
 *     emitter fabricated `name="User"` and arcade-gen renders an initial (and,
 *     with no name, a person icon) whenever an Avatar has no image;
 *   - a "⌘"+"K" pill lost the K, because only the first text layer was read.
 *
 * These are text assertions against the emitter source rather than a full import,
 * because a real import needs network + a Figma PAT. The behaviour itself was
 * verified by re-importing that node: avatars 24 → 6, keys ["⌘","K"], and both bad
 * mappings reported as shape-vetoed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "../../../server/figma/kitEmit.ts"), "utf8");
const BRANCH = readFileSync(join(__dirname, "../../../server/figma/kitEmitBranch.ts"), "utf8");

describe("shape guard on kit mappings", () => {
  it("declares mappingFitsBox and applies it at the mapping gate", () => {
    expect(SRC).toMatch(/function mappingFitsBox\(/);
    // Must run BEFORE the coverage tally, or a vetoed mapping inflates the kit %.
    const guardAt = SRC.indexOf("!mappingFitsBox(k.kit, b)");
    const tallyAt = SRC.indexOf("totalInstances++");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(tallyAt);
  });

  it("only vetoes shapes that cannot be a mistake", () => {
    // Thresholds are deliberately extreme: a moderate rule vetoed 9 sound mappings
    // in the hygiene fixtures, and a false veto is worse than the bug it fixes.
    expect(SRC).toMatch(/if \(kit === "IconButton"\) return ratio < 3;/);
    expect(SRC).toMatch(/if \(kit === "Select"\) return ratio > 1\.1;/);
  });

  it("shape-checks the labelless-Button downgrade to IconButton", () => {
    // The wordmark pill matched Button, not IconButton, so guarding only the
    // mapping gate left this path open.
    expect(SRC).toMatch(/if \(!mappingFitsBox\("IconButton", b\)\)/);
  });

  it("reports vetoed mappings instead of dropping them silently", () => {
    expect(SRC).toMatch(/shapeRejected/);
    expect(BRANCH).toMatch(/shape-vetoed/);
  });
});

describe("the emitter never invents a visual Figma does not paint", () => {
  it("does not fabricate an avatar name", () => {
    expect(SRC).not.toMatch(/\? init : "User"/);
  });

  it("emits nothing for an avatar with neither image nor initials", () => {
    // arcade-gen's Avatar has no empty state: no name → person glyph. So the only
    // faithful output is no element at all.
    expect(SRC).toMatch(/if \(!v && !name\) return;/);
    // The skip must precede the coverage/import bookkeeping, or we'd import Avatar
    // and count an instance that never renders.
    const skipAt = SRC.indexOf("if (!v && !name) return;");
    const addAt = SRC.indexOf('usedKit.add("Avatar")', skipAt);
    expect(skipAt).toBeLessThan(addAt);
  });
});

describe("KeyboardShortcut keeps every key", () => {
  it("joins all text layers rather than taking the first", () => {
    expect(SRC).toMatch(/texts\.length \? texts\.join\(" "\) : "⌘K"/);
    expect(SRC).not.toMatch(/const combo = texts\[0\] \?\? "⌘K"/);
  });
});

describe("the computer wordmark reuses the kit's glyph", () => {
  it("emits comp + the Computer glyph + ter instead of flattening vector letters", () => {
    // The design draws "computer" as individual VECTOR glyphs with no text nodes, so
    // a faithful emit paints each letter as its filled bbox (a row of black blocks)
    // and a control substitution stretches one letter across the pill. The kit
    // already solved this — NavSidebar's ComputerWordmark is "comp" + the arcade-gen
    // `Computer` glyph as the "u" + "ter" — so rebuild it from that same glyph.
    expect(SRC).toMatch(/sn === "Computer Action"/);
    expect(SRC).toMatch(/comp<Computer size=/);
    // The closing "ter" sits at the end of a template literal, so match the
    // glyph-then-text boundary rather than full markup (the </span> is concatenated
    // from the next string).
    expect(SRC).toMatch(/\/>ter/);
  });

  it("keeps the wordmark out of the way when the instance has real text", () => {
    // Guarded by !containsText so a variant that DOES carry live copy is not
    // overwritten with a hardcoded wordmark.
    expect(SRC).toMatch(/sn === "Computer Action" && !containsText\(n\)/);
  });
});
