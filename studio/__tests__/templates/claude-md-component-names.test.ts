// @vitest-environment node
//
// Guard: every component the generation rules TELL the agent to write must
// actually exist in the design-system barrel, with the sub-parts the rules
// claim.
//
// Why this test exists: arcade-gen 2.0 renamed the segmented control from
// `ToggleGroup` to `SegmentedControl` and reused the `ToggleGroup` name for a
// different, NON-compound component. `CLAUDE.md.tpl` kept telling the agent to
// write `<ToggleGroup.Root>`, which still imports cleanly (the export exists!)
// but is `undefined` at runtime → "Element type is invalid" → white frame. The
// same audit found `<SplitButton.Root>` (never compound), `variant="ghost"` on
// Button, `mode="primary"` on Link, `layout="row"` on Banner, `onChange` on
// Checkbox/Switch, and a `children`-shaped `KeyboardShortcut`.
//
// Nothing else in the pipeline catches a wrong FACT in the rules — the import
// validator only checks that the ROOT name exists, and the frame typechecker
// doesn't see the template at all. So the facts are derived from the shipped
// type declarations here instead of being trusted.
//
// This is deliberately DERIVED, not a hardcoded list: on the next arcade-gen
// bump the barrel changes and this test fails on exactly the rows that went
// stale. See auto-memory feedback_scalable_accuracy.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PRIMITIVE_CAPABILITIES } from "../../server/kitManifest";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.resolve(__dirname, "../..");
const TPL = path.join(STUDIO, "templates/CLAUDE.md.tpl");

/** Sections whose TABLES are prescriptive — "write this component". Prose
 *  elsewhere in the file mentions names in the negative ("never use X"), so
 *  only these tables are scanned for positive claims. */
const PRESCRIPTIVE_SECTIONS = new Set([
  "### Primitives quick-ref",
  "### Chat / agent primitives",
  "### Icons",
  "### Picking the right building block for a Figma instance",
  "### Common wrong choices (recurring failures)",
]);

/**
 * Names the template deliberately says do NOT exist. Each is asserted ABSENT
 * from the barrel below — so if the kit ever adds one, this test fails and
 * tells us to drop the warning instead of leaving a lie in the rules.
 */
const DOCUMENTED_AS_ABSENT = [
  "PaperPlane", // Send icon — the kit has no paper plane; use ArrowUpSmall
  "TrashCan", // it's TrashBin
  "MoreVertical", // it's ThreeDotsVertical
  "Notification", // it's Bell
];

/**
 * Bare capitalized words that appear inside backticks in a prescriptive table
 * but are NOT component references. Kept tiny and explained — a growing list
 * here means the extractor needs tightening, not more entries.
 */
const NOT_COMPONENTS = new Set([
  "Kind", // Figma variant AXIS name ("check variant against Figma Kind/Intent")
  "Intent", // ditto
  "Name", // path placeholder in `.eject/<Name>.tsx`
  "ChatInterface", // invented name in a sample target-preamble block
  "Label", // the literal `Label: Value ⌄` filter-pill shape
  "Value", // ditto
  "TKT", // sample record id `TKT-1234`
  "ISS", // sample record id `ISS-88`
  "Date", // TS type in `date: Date | string | number`
  "Root", // bare `.Root` mentioned as a suffix
  "Trigger",
  "Content",
  "Large", // icon-name suffix discussed as a naming convention
  "Small",
  "Element", // the React error string "Element type is invalid"
  ...DOCUMENTED_AS_ABSENT,
]);

// ---- Barrel truth, read from the shipped type declaration ----

function arcadeGenTypeDecl(): string {
  const require = createRequire(import.meta.url);
  const dist = path.dirname(require.resolve("@xorkavi/arcade-gen"));
  for (const f of ["index.d.mts", "index.d.cts", "index.d.ts"]) {
    const p = path.join(dist, f);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }
  throw new Error("no bundled type declaration found in @xorkavi/arcade-gen/dist");
}

const DECL = arcadeGenTypeDecl();

/** Value exports of the barrel (drops `type X`, resolves `X as Y` to Y). */
function barrelExports(decl: string): Set<string> {
  const out = new Set<string>();
  const line = decl.split("\n").find((l) => l.startsWith("export { "));
  if (!line) throw new Error("no `export { … }` block in the type declaration");
  const body = line.slice(line.indexOf("{") + 1, line.lastIndexOf("}"));
  for (const raw of body.split(",")) {
    const token = raw.trim();
    if (!token || /^type\s/.test(token)) continue;
    const as = token.match(/^([A-Za-z_][\w$]*)\s+as\s+([A-Za-z_][\w$]*)$/);
    out.add(as ? as[2] : token);
  }
  return out;
}

/**
 * Sub-component members per compound export, from `declare const X: … {` blocks.
 * Only PascalCase members count — lowercase keys are inline prop-object types
 * that happen to be nested in the same declaration.
 */
function compoundMembers(decl: string): Map<string, Set<string>> {
  const lines = decl.split("\n");
  const out = new Map<string, Set<string>>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^declare const ([A-Z][A-Za-z0-9]*): /);
    if (!m || !/\{\s*$/.test(lines[i])) continue;
    const members = new Set<string>();
    let depth = 1;
    for (let j = i + 1; j < lines.length && depth > 0; j++) {
      depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
      const mem = lines[j].match(/^\s{2}([A-Z][A-Za-z0-9]*)\??:/);
      if (mem) members.add(mem[1]);
    }
    if (members.size > 0) out.set(m[1], members);
  }
  return out;
}

const BARREL = barrelExports(DECL);
const MEMBERS = compoundMembers(DECL);

/**
 * prototype-kit's own barrel (`arcade-prototypes`) — composites + templates.
 *
 * VALUE exports only, parsed from the export statements. The previous version
 * matched any capitalized word in the file, which swallowed comment prose
 * ("Composites"), path segments and `export type` prop-type names. Every
 * spurious member SILENTLY DISABLED the sub-part assertion for that name
 * (`if (KIT.has(r.root)) continue`), so a loose match here did not merely
 * over-report — it switched off the check this file exists to perform.
 */
function kitExports(): Set<string> {
  const src = fs.readFileSync(path.join(STUDIO, "prototype-kit/index.ts"), "utf-8");
  const out = new Set<string>();
  for (const m of src.matchAll(/^export \{([^}]*)\} from/gm)) {
    for (const token of m[1].split(",")) {
      const name = token.trim().replace(/^[\w$]+\s+as\s+/, "");
      if (/^[A-Z][A-Za-z0-9]*$/.test(name)) out.add(name);
    }
  }
  return out;
}

const KIT = kitExports();

/**
 * Coverage floors.
 *
 * A name-based assertion cannot see its own extractor going quiet. If a future
 * arcade-gen bump reformats the bundled declaration, `compoundMembers` returns an
 * empty map, every sub-part check below falls through `if (!members) continue`,
 * and the suite passes green while verifying nothing at all — the exact silent rot
 * this file was written to stop, one level up. Counts are the only thing that
 * notices. Raise them deliberately as the kit grows; never lower one to green a run.
 */
const FLOORS = {
  barrel: 250,
  compounds: 20,
  kit: 34,
  subPartsChecked: 75,
  // The capability prose is prop-heavy; only a handful of entries name a
  // sub-part at all. Small, but it still catches the extractor going quiet.
  capabilityRefsChecked: 3,
};

// ---- Capability prose (rendered into KIT-MANIFEST, so it carries template weight) ----

/**
 * Sub-component shapes the capability prose quotes in order to WARN against them
 * ("writing `<ToggleGroup.Root>` crashes the frame"). Each is asserted ABSENT from
 * the barrel below, so the day one becomes real the warning is a lie and this test
 * says so — the same bidirectional contract as DOCUMENTED_AS_ABSENT above.
 */
const CAPABILITY_BROKEN_SHAPES = ["ToggleGroup.Root"];

/** Backticked tokens in the prose that are not component references. */
const CAPABILITY_NOT_COMPONENTS = new Set([...NOT_COMPONENTS, "STRINGS", "TRUE", "NO", "NOT"]);

type CapRef = { root: string; sub: string | null; where: string };

/** Component references made by the capability prose, in both `X.Y` and <X.Y> form. */
function capabilityRefs(): CapRef[] {
  const refs: CapRef[] = [];
  for (const [where, prose] of Object.entries(PRIMITIVE_CAPABILITIES)) {
    for (const m of prose.matchAll(/<([A-Z][A-Za-z0-9]*)(?:\.([A-Z][A-Za-z0-9]*))?\b/g)) {
      refs.push({ root: m[1], sub: m[2] ?? null, where });
    }
    for (const m of prose.matchAll(/`([^`]+)`/g)) {
      const id = m[1].trim().match(/^<?([A-Z][A-Za-z0-9]*)(?:\.([A-Z][A-Za-z0-9]*))?\/?>?$/);
      if (id) refs.push({ root: id[1], sub: id[2] ?? null, where });
    }
  }
  return refs;
}

const CAP_REFS = capabilityRefs();


// ---- What the template claims ----

type Ref = { root: string; sub: string | null; where: string };

function templateRefs(): Ref[] {
  const lines = fs.readFileSync(TPL, "utf-8").split("\n");
  const refs: Ref[] = [];
  const push = (root: string, sub: string | null, where: string) => {
    refs.push({ root, sub, where });
  };

  let inPrescriptive = false;
  let inWrongChoices = false;
  lines.forEach((rawLine, idx) => {
    const at = `line ${idx + 1}`;
    if (/^#{2,4} /.test(rawLine)) {
      inPrescriptive = PRESCRIPTIVE_SECTIONS.has(rawLine.trim());
      inWrongChoices = rawLine.trim() === "### Common wrong choices (recurring failures)";
    }

    // The wrong-choices table's FIRST cell is the anti-pattern being warned
    // against ("You're tempted to use `<Card.Root>`") — quoting a broken shape
    // is the point of the row, so that cell is not a claim. Scan cells 2+ only.
    let line = rawLine;
    if (inWrongChoices && rawLine.startsWith("|")) {
      const cells = rawLine.split("|");
      line = cells.slice(2).join("|");
    }

    // 1. JSX tags — `<Name>` / `<Name.Sub>` is a component reference by
    //    construction, so these need no section gating.
    for (const m of line.matchAll(/<([A-Z][A-Za-z0-9]*)(?:\.([A-Z][A-Za-z0-9]*))?\b/g)) {
      push(m[1], m[2] ?? null, at);
    }

    // 2. Bare backticked identifiers, but only inside a prescriptive table row.
    if (!inPrescriptive || !rawLine.startsWith("|")) return;
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const token = m[1].trim();
      const id = token.match(/^<?([A-Z][A-Za-z0-9]*)(?:\.([A-Z][A-Za-z0-9]*))?\/?>?$/);
      if (id) push(id[1], id[2] ?? null, at);
    }
  });
  return refs;
}

const REFS = templateRefs();

/** How many sub-part claims the assertion below actually compared, not just saw. */
let subPartsChecked = 0;

describe("CLAUDE.md.tpl component names", () => {
  it("extracts a meaningful number of component references", () => {
    // Sanity floor: if the extractor silently stops matching, the two real
    // assertions below would pass vacuously.
    expect(REFS.length).toBeGreaterThan(100);
  });

  it("every component it tells the generator to use exists in a barrel", () => {
    const unresolved = [
      ...new Set(
        REFS.filter(
          (r) => !NOT_COMPONENTS.has(r.root) && !BARREL.has(r.root) && !KIT.has(r.root),
        ).map((r) => `${r.root} (${r.where})`),
      ),
    ].sort();
    expect(
      unresolved,
      `CLAUDE.md.tpl names components that are in neither @xorkavi/arcade-gen nor prototype-kit:\n  ${unresolved.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every compound sub-part it names is a real sub-part", () => {
    const bogus: string[] = [];
    for (const r of REFS) {
      if (!r.sub || NOT_COMPONENTS.has(r.root)) continue;
      // Only arcade-gen compounds are checkable. Skip kit components (their
      // wrappers can add members) and any export with no derivable member list.
      if (KIT.has(r.root)) continue;
      const members = MEMBERS.get(r.root);
      if (!members) continue;
      subPartsChecked++;
      if (!members.has(r.sub)) {
        bogus.push(`${r.root}.${r.sub} (${r.where}) — real sub-parts: ${[...members].join(", ")}`);
      }
    }
    expect(
      [...new Set(bogus)].sort(),
      `CLAUDE.md.tpl names sub-components that don't exist. Writing one renders \`undefined\` and crashes the frame with "Element type is invalid":\n  ${bogus.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the names it warns don't exist really don't", () => {
    // Bidirectional contract: the rules say "there is no PaperPlane". If the
    // kit ever ships one, that warning becomes a lie and should be deleted.
    const nowPresent = DOCUMENTED_AS_ABSENT.filter((n) => BARREL.has(n));
    expect(
      nowPresent,
      `arcade-gen now exports ${nowPresent.join(", ")} — CLAUDE.md.tpl still tells the generator these don't exist. Update the rules.`,
    ).toEqual([]);
  });

  it("ToggleGroup is not compound and SegmentedControl is (the 2.0 swap)", () => {
    // Pins the specific regression this whole test was written for, so a
    // future refactor of the extractor can't quietly stop covering it.
    expect(MEMBERS.get("SegmentedControl")).toContain("Root");
    expect(MEMBERS.get("ToggleGroup")?.has("Root")).toBe(false);
    expect(MEMBERS.get("ToggleGroup")).toContain("Item");
    expect(MEMBERS.has("SplitButton")).toBe(false);
    expect(BARREL.has("SplitButtonItem")).toBe(true);
  });

  it("the derived truth it checks against is actually populated", () => {
    // Floors, not names: see FLOORS above. Each of these silently going empty
    // turns one of the assertions in this file into a no-op that still passes.
    expect(BARREL.size, "barrel exports collapsed — is the `export { … }` line still one line?").toBeGreaterThanOrEqual(FLOORS.barrel);
    expect(MEMBERS.size, "compound member extraction collapsed — did the declaration format change?").toBeGreaterThanOrEqual(FLOORS.compounds);
    expect(KIT.size, "prototype-kit export parsing collapsed").toBeGreaterThanOrEqual(FLOORS.kit);
  });

  it("it compared a meaningful number of sub-part claims, not just skipped them", () => {
    // Every skip path in the assertion above (kit component, no derivable members)
    // is a claim that went UNVERIFIED. Without this, widening a skip would read as
    // a pass.
    expect(
      subPartsChecked,
      `only ${subPartsChecked} sub-part claims were actually compared against the barrel — the rest hit a skip path`,
    ).toBeGreaterThanOrEqual(FLOORS.subPartsChecked);
  });

  it("the exports the write-hook says have no `.Root` really have none", () => {
    // Mirrors NO_ROOT_SUBPART in server/hooks/validateComponentProps.mjs, which
    // hardcodes this set to stay cheap on every Write. If a kit bump makes one
    // of these compound, the hook would start blocking a VALID frame — fail here
    // so we notice before shipping.
    for (const name of ["Card", "CardRadioSelect", "Grid", "ToggleGroup"]) {
      expect(BARREL.has(name), `${name} vanished from the barrel`).toBe(true);
      expect(MEMBERS.get(name)?.has("Root") ?? false, `${name} gained a .Root`).toBe(false);
    }
  });
});

/**
 * The same guard, applied to `PRIMITIVE_CAPABILITIES` in server/kitManifest.ts.
 *
 * That prose is rendered into KIT-MANIFEST.md and read by the generating agent, so a
 * wrong fact there lands with exactly the force of a wrong fact in CLAUDE.md.tpl —
 * but kitManifest.test.ts only asserts that certain STRINGS appear in it, which a
 * confidently-wrong claim passes. Deliberately NOT checked here: whether an arbitrary
 * prop name exists. Input/Button take theirs from `ButtonHTMLAttributes` and
 * `VariantProps`, Select/Tabs/Accordion from the Radix primitive types, and Switch
 * through an `Omit<ToggleProps, …>` intersection — a positive prop-existence check
 * would need real type resolution and would otherwise fire on valid props. Compound
 * SHAPE is the part that is fully derivable, and it is the part that has burned us.
 */
describe("PRIMITIVE_CAPABILITIES facts", () => {
  it("names only components that exist", () => {
    const unknown = Object.keys(PRIMITIVE_CAPABILITIES).filter((n) => !BARREL.has(n) && !KIT.has(n));
    expect(unknown, `the capability table documents components no barrel exports: ${unknown.join(", ")}`).toEqual([]);
  });

  it("covers a meaningful number of primitives", () => {
    expect(Object.keys(PRIMITIVE_CAPABILITIES).length).toBeGreaterThanOrEqual(12);
  });

  it("every component it mentions in passing exists too", () => {
    // The prose steers the agent sideways ("use `MultiSelect` or `Combobox` instead"),
    // and a rename would leave it recommending a component that no longer exists.
    const unresolved = [
      ...new Set(
        CAP_REFS.filter(
          (r) => !CAPABILITY_NOT_COMPONENTS.has(r.root) && !BARREL.has(r.root) && !KIT.has(r.root),
        ).map((r) => `${r.root} (in the ${r.where} entry)`),
      ),
    ].sort();
    expect(unresolved, `the capability table recommends components that do not exist:\n  ${unresolved.join("\n  ")}`).toEqual([]);
  });

  it("every sub-part it writes positively is real", () => {
    let checked = 0;
    const bogus: string[] = [];
    for (const r of CAP_REFS) {
      if (!r.sub || CAPABILITY_NOT_COMPONENTS.has(r.root)) continue;
      if (CAPABILITY_BROKEN_SHAPES.includes(`${r.root}.${r.sub}`)) continue; // quoted to warn against
      if (KIT.has(r.root)) continue;
      const members = MEMBERS.get(r.root);
      if (!members) continue;
      checked++;
      if (!members.has(r.sub)) {
        bogus.push(`${r.root}.${r.sub} (in the ${r.where} entry) — real sub-parts: ${[...members].join(", ")}`);
      }
    }
    expect(
      checked,
      "no capability sub-part claim was actually compared — the extractor or the prose format moved",
    ).toBeGreaterThanOrEqual(FLOORS.capabilityRefsChecked);
    expect(
      [...new Set(bogus)].sort(),
      `the capability table tells the agent to write sub-components that render \`undefined\`:\n  ${bogus.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the shapes it warns are broken really are broken", () => {
    const nowReal = CAPABILITY_BROKEN_SHAPES.filter((shape) => {
      const [root, sub] = shape.split(".");
      return MEMBERS.get(root)?.has(sub) ?? false;
    });
    expect(
      nowReal,
      `${nowReal.join(", ")} exists now — the capability table still warns it crashes the frame. Update the prose.`,
    ).toEqual([]);
  });
});
