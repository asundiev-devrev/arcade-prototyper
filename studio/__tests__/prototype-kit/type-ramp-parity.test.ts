// @vitest-environment node
//
// `prototype-kit/styles.css` carries a VERBATIM copy of arcade-gen's type ramp
// (arcade-gen/src/styles/typography.css). It has to be a copy: the npm package
// only ships a pre-compiled stylesheet containing the ramp entries arcade-gen
// itself happened to use, so a host importing that alone gets an arbitrary
// subset.
//
// A copy rots. The previous one — hand-mirrored into studio/src/styles/
// tailwind.css — carried 15 of the ramp's 32 entries, so `text-body-large-bold`,
// `text-system-small-medium`, `text-body-small-bold` and the whole
// `text-display-*` family silently produced NOTHING in both hosts. A partial
// mirror is worse than no mirror: the class name looks supported, and the only
// symptom is type at the wrong size.
//
// This test fails when the two diverge. Skipped when the arcade-gen clone isn't
// present (matching prototype-kit-boundary.test.ts), so CI without it passes.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KIT_CSS = path.join(STUDIO, "prototype-kit/styles.css");

const ARCADE_GEN_ROOT =
  process.env.ARCADE_GEN_ROOT ?? path.resolve(process.env.HOME ?? "", "arcade-gen");
const TYPOGRAPHY = path.join(ARCADE_GEN_ROOT, "src/styles/typography.css");
const CLONE_PRESENT = fs.existsSync(TYPOGRAPHY);

/** Line-anchored on purpose: arcade-gen's doc header contains the prose
 *  "Uses Tailwind v4 @utility syntax instead of JS addUtilities", which an
 *  unanchored pattern reads as a utility named `syntax`. */
const utilityNames = (css: string): string[] =>
  [...css.matchAll(/^@utility\s+([a-z0-9-]+)/gm)].map((m) => m[1]).sort();

describe("kit type ramp", () => {
  it("declares a ramp at all", () => {
    // Runs with or without the clone — a kit stylesheet that lost its ramp is
    // the failure this whole file exists to prevent.
    const names = utilityNames(fs.readFileSync(KIT_CSS, "utf-8"));
    expect(names.length).toBeGreaterThan(25);
    for (const required of ["text-body", "text-body-small", "text-body-large-bold", "text-system-small-medium"]) {
      expect(names, `${required} missing from the kit ramp`).toContain(required);
    }
  });
});

describe.skipIf(!CLONE_PRESENT)("kit type ramp parity with arcade-gen", () => {
  it("declares exactly the same utilities as arcade-gen's typography.css", () => {
    const ours = utilityNames(fs.readFileSync(KIT_CSS, "utf-8"));
    const theirs = utilityNames(fs.readFileSync(TYPOGRAPHY, "utf-8"));
    const missing = theirs.filter((n) => !ours.includes(n));
    const extra = ours.filter((n) => !theirs.includes(n));
    expect(
      { missing, extra },
      `prototype-kit/styles.css has drifted from arcade-gen's type ramp.\n` +
        `  missing (arcade-gen has, kit doesn't): ${missing.join(", ") || "none"}\n` +
        `  extra (kit invented): ${extra.join(", ") || "none"}\n` +
        `  Re-copy the ramp from ${TYPOGRAPHY}.`,
    ).toEqual({ missing: [], extra: [] });
  });

  it("copies each declaration byte-for-byte", () => {
    // Same names but edited values would be worse than drift — the kit would
    // render a different type scale than the design system it claims to mirror.
    const ours = fs.readFileSync(KIT_CSS, "utf-8");
    const theirs = fs.readFileSync(TYPOGRAPHY, "utf-8");
    const bodies = (css: string) => {
      const out = new Map<string, string>();
      for (const m of css.matchAll(/^@utility\s+([a-z0-9-]+)\s*\{([^}]*)\}/gm)) {
        out.set(m[1], m[2].replace(/\s+/g, " ").trim());
      }
      return out;
    };
    const a = bodies(ours);
    const b = bodies(theirs);
    const changed: string[] = [];
    for (const [name, body] of b) {
      if (a.has(name) && a.get(name) !== body) changed.push(name);
    }
    expect(
      changed,
      `these ramp entries were edited in the kit copy instead of being copied:\n  ${changed.join("\n  ")}`,
    ).toEqual([]);
  });
});
