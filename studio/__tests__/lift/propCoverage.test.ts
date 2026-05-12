// studio/__tests__/lift/propCoverage.test.ts
//
// Lint: every prop used on a mapped Studio primitive across the fixture
// corpus must be covered by the mapping's `knownStudioProps` OR
// `droppedStudioProps`. Prevents the "invent a prop name that pattern-
// matches DS conventions" hallucination (Avatar.displayName was produced
// by a 2026-05-12 live-lift run for exactly this reason — mapping had
// no `knownStudioProps` at that point).
//
// Scope: only mappings that have declared `knownStudioProps` participate.
// Entries without coverage fields are ignored so the table can be filled
// in incrementally — but adding `knownStudioProps: []` to a mapping opts
// it in.
//
// Detection is regex-based, not JSX-parsed. We look for `<MappingName `
// followed by identifier=... or identifier={... patterns. Props written
// via spread (`{...props}`) are invisible to this lint — that's a known
// limitation, and an acceptable one because spread means "trusted
// internal call", not "agent-guessed prop name".

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { ALL_MAPPINGS } from "../../src/lift/mappings";

const FIXTURE_ROOTS = [
  path.join(__dirname, "fixtures"),
  path.join(__dirname, "loop-fixtures"),
];

function collectFixtureSources(): string[] {
  const out: string[] = [];
  for (const root of FIXTURE_ROOTS) {
    walkTsx(root, out);
  }
  return out;
}

function walkTsx(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsx(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      out.push(fs.readFileSync(full, "utf-8"));
    }
  }
}

/**
 * For a given component name, find the set of prop names used on any
 * opening JSX tag in the source text.
 *
 * Regex covers: `<Name prop` / `<Name ... prop=...` / `<Name\nprop=...` /
 * `<Name.Subcomponent prop=` (the Subcomponent call still contributes
 * props to the same name, which is fine — it's the same component). The
 * matcher stops at the closing `>` so we only pick up attributes of one
 * element at a time.
 */
function propsUsedOn(source: string, componentName: string): Set<string> {
  const props = new Set<string>();
  // `<ComponentName` followed by anything up to `>` or `/>`. Non-greedy
  // so we don't eat past the close of the opening tag.
  const tagOpenRe = new RegExp(
    `<${componentName}(?:\\.[A-Z][A-Za-z0-9]*)?(\\s[\\s\\S]*?)(?:/?>)`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = tagOpenRe.exec(source)) !== null) {
    const attrs = m[1];
    // Match `foo={...}` or `foo="..."` or bare `foo` (boolean). Prop
    // identifiers in JSX can contain letters, digits, `-`, `_`.
    const propRe = /(?:^|\s)([A-Za-z_][A-Za-z0-9_-]*)(?:=|(?=\s|\/>|>))/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(attrs)) !== null) {
      props.add(pm[1]);
    }
  }
  return props;
}

describe("prop coverage lint", () => {
  const sources = collectFixtureSources();

  for (const entry of ALL_MAPPINGS) {
    if (!entry.knownStudioProps) continue;

    const covered = new Set<string>([
      ...entry.knownStudioProps,
      ...(entry.droppedStudioProps?.map((d) => d.prop) ?? []),
      // `key` is React's scheduler prop; covered universally.
      "key",
      "ref",
      // `data-*` and `aria-*` attributes are not component props worth
      // tracking here; callers use them for testing hooks and a11y.
    ]);

    it(`${entry.studio.source}/${entry.studio.name}: fixtures use only covered props`, () => {
      const used = new Set<string>();
      for (const src of sources) {
        for (const p of propsUsedOn(src, entry.studio.name)) {
          used.add(p);
        }
      }
      const uncovered = [...used].filter(
        (p) => !covered.has(p) && !p.startsWith("data-") && !p.startsWith("aria-"),
      );
      expect(
        uncovered,
        `${entry.studio.name} mapping declares knownStudioProps but these props are used in fixtures without coverage: ${uncovered.join(", ")}. Add to knownStudioProps or droppedStudioProps in src/lift/mappings/.`,
      ).toEqual([]);
    });
  }
});

describe("prop coverage — regression guards", () => {
  it("Avatar mapping declares `name` but NOT `displayName`", () => {
    // Live-lift hallucination guard: the agent saw the mapping and
    // invented displayName. The presence of `name` in knownStudioProps
    // + the explicit slot note is what catches the mistake at review
    // time; the lint only fires for new uncovered props in fixtures.
    const avatar = ALL_MAPPINGS.find(
      (m) => m.studio.source === "arcade" && m.studio.name === "Avatar",
    )!;
    expect(avatar.knownStudioProps).toContain("name");
    expect(avatar.knownStudioProps).not.toContain("displayName");
  });

  it("Tag mapping lists `appearance` as dropped, not unknown", () => {
    // Silent-drop guard: the agent dropped Chip.appearance twice in
    // live runs because the mapping didn't explicitly acknowledge it.
    const tag = ALL_MAPPINGS.find(
      (m) => m.studio.source === "arcade" && m.studio.name === "Tag",
    )!;
    expect(tag.droppedStudioProps?.map((d) => d.prop)).toContain("appearance");
    expect(tag.knownStudioProps).toContain("appearance");
  });
});
