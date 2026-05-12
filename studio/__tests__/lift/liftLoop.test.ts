// studio/__tests__/lift/liftLoop.test.ts
//
// PR gate for the lift-manifest rules-over-tables plan. For each archetype
// fixture under loop-fixtures/, build the manifest, compute the decision-
// point metric (see src/lift/metrics.ts), and compare against the expected
// counts recorded in expected.json.
//
// Behavior:
//   - Actual count > expected → FAIL ("regression: add an entry that
//     covers the case, or justify the increase in the expected file").
//   - Actual count < expected → FAIL ("improvement: update the expected
//     file to lock in the win").
//   - Actual count === expected → PASS.
//
// This asymmetric failure mode is intentional. A PR that reduces decision
// points is the point of the plan, but the numbers in expected.json are
// the contract; every change should be visible in git.
//
// To record the baseline the first time or after an intentional change:
//   UPDATE_LIFT_LOOP=1 pnpm run studio:test liftLoop

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildManifest } from "../../src/lift/buildManifest";
import { computeMetrics, type LiftMetrics } from "../../src/lift/metrics";

const FIXTURES_DIR = path.join(__dirname, "loop-fixtures");
const UPDATE = process.env.UPDATE_LIFT_LOOP === "1";

const ARCHETYPES = ["list-view", "settings-list", "settings-form", "detail", "ad-hoc"] as const;

interface Expected extends LiftMetrics {
  /** Human note about why these numbers are what they are — helps reviewers. */
  note?: string;
}

function loadExpected(dir: string): Expected {
  const file = path.join(dir, "expected.json");
  const raw = fs.readFileSync(file, "utf-8");
  return JSON.parse(raw);
}

function writeExpected(dir: string, actual: LiftMetrics) {
  const file = path.join(dir, "expected.json");
  const existing = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as Expected) : {};
  const next: Expected = { ...existing, ...actual };
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
}

describe("lift-loop decision-point gate", () => {
  for (const archetype of ARCHETYPES) {
    it(`${archetype}`, () => {
      const dir = path.join(FIXTURES_DIR, archetype);
      const source = fs.readFileSync(path.join(dir, "index.tsx"), "utf-8");

      const manifest = buildManifest({
        projectSlug: "loop",
        frameSlug: archetype,
        frameAbsPath: path.join(dir, "index.tsx"),
        frameSource: source,
        intentSummary: "",
      });
      const actual = computeMetrics(manifest);

      if (UPDATE) {
        writeExpected(dir, actual);
        return;
      }

      const expected = loadExpected(dir);
      const expectedMetrics: LiftMetrics = {
        decisionPoints: expected.decisionPoints,
        unmapped: expected.unmapped,
        judgment: expected.judgment,
        naMappings: expected.naMappings,
        needsReviewerProps: expected.needsReviewerProps,
        iconsAbsorbed: expected.iconsAbsorbed,
      };

      // Per-bucket comparison gives readable failures ("judgment dropped by 2")
      // instead of an opaque "totals changed" message.
      expect(actual, hint(archetype, actual, expectedMetrics)).toEqual(expectedMetrics);
    });
  }
});

function hint(archetype: string, actual: LiftMetrics, expected: LiftMetrics): string {
  const delta = actual.decisionPoints - expected.decisionPoints;
  if (delta > 0) {
    return (
      `[${archetype}] decision points increased by ${delta}. ` +
      `If this is an intentional regression (rare — requires justification), ` +
      `run UPDATE_LIFT_LOOP=1 pnpm run studio:test liftLoop. ` +
      `Otherwise, add a mapping/convention that covers the new case.`
    );
  }
  if (delta < 0) {
    return (
      `[${archetype}] decision points decreased by ${-delta} — nice. ` +
      `Lock it in: UPDATE_LIFT_LOOP=1 pnpm run studio:test liftLoop.`
    );
  }
  return `[${archetype}] per-bucket breakdown changed despite equal totals — unusual. Inspect manually.`;
}
