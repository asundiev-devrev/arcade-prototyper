// studio/__tests__/lift/drift.test.ts
//
// Unit tests for the drift audit — uses a synthetic fake-devrev-web tree
// so they always run. The opt-in integration test (further down) runs
// against a real devrev-web clone when DRIFT_AUDIT=1 is set; otherwise
// it skips so CI stays green for contributors who don't have the clone.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  runDriftAudit,
  formatDriftResult,
  AUDITED_TOKENS,
} from "../../src/lift/drift";
import { ALL_MAPPINGS } from "../../src/lift/mappings";
import { ICON_ANCHORS } from "../../src/lift/icons";

/**
 * Build a synthetic devrev-web tree that satisfies the current mapping
 * table + icon anchors. Tests then mutate individual files to verify each
 * drift category fires.
 */
function buildFakeDevrevWeb(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drift-audit-"));
  const paths: Record<string, string[]> = {};

  // For every mapping with a real production.source, stand up a fake
  // index.ts at a plausible path with the expected export.
  const uniqueSpecifiers = new Set(
    ALL_MAPPINGS.filter((m) => m.production.source !== "n/a").map(
      (m) => m.production.source,
    ),
  );
  for (const spec of uniqueSpecifiers) {
    const relPath = specToFakePath(spec);
    paths[spec] = [relPath];
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const exports = ALL_MAPPINGS.filter((m) => m.production.source === spec).map(
      (m) => m.production.name,
    );
    // Write a flat index file with `export const <Name> = {}` for each
    // expected export. Matches what the audit's declRe accepts.
    fs.writeFileSync(
      abs,
      exports.map((n) => `export const ${n} = {};`).join("\n") + "\n",
    );
  }

  // Prior-art paths: create empty files at each one so existsSync passes.
  for (const entry of ALL_MAPPINGS) {
    for (const ex of entry.priorArt ?? []) {
      const abs = path.join(root, ex.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (!fs.existsSync(abs)) fs.writeFileSync(abs, "// fake\n");
    }
  }

  // ICON_TYPES enum with every anchor present.
  const iconTypesPath = path.join(
    root,
    "libs/shared/ui-icons/src/icon/types.ts",
  );
  fs.mkdirSync(path.dirname(iconTypesPath), { recursive: true });
  fs.writeFileSync(
    iconTypesPath,
    "export enum ICON_TYPES {\n" +
      ICON_ANCHORS.map((a) => `  ${a.productionIconType} = '${a.productionIconType}',`).join(
        "\n",
      ) +
      "\n}\n",
  );

  // tsconfig.base.json with the paths map.
  fs.writeFileSync(
    path.join(root, "tsconfig.base.json"),
    JSON.stringify({ compilerOptions: { paths } }, null, 2),
  );

  // Fake theme CSS: define every audited token with a real color so the
  // token-resolution category passes. Drift audit scans a specific set
  // of well-known devrev-web CSS locations; we write the light-mode file
  // because that's the one in every env. For tokens present in the
  // Figma-token-values snapshot, we echo the Figma hex directly so the
  // figma-value-drift category also stays quiet — the tree is meant to
  // represent a "everything in sync" baseline. Tokens not in the
  // snapshot get an arbitrary valid color.
  const snapshotFile = path.join(
    __dirname,
    "..",
    "..",
    "src",
    "lift",
    "figma-token-values.json",
  );
  const figmaValues: Record<string, string> = fs.existsSync(snapshotFile)
    ? JSON.parse(fs.readFileSync(snapshotFile, "utf-8"))
    : {};
  const lightCssPath = path.join(
    root,
    "apps/product/styles/light-styles.css",
  );
  fs.mkdirSync(path.dirname(lightCssPath), { recursive: true });
  fs.writeFileSync(
    lightCssPath,
    ":root {\n" +
      AUDITED_TOKENS.map((t, i) => {
        const figmaHex = figmaValues[t];
        if (figmaHex && /^#[0-9a-f]{6}$/i.test(figmaHex)) {
          return `  ${t}: ${figmaHex};`;
        }
        return `  ${t}: hsl(0, 0%, ${95 - i}%);`;
      }).join("\n") +
      "\n}\n",
  );

  return root;
}

function specToFakePath(spec: string): string {
  // Map @devrev-web/<rest> → libs/<rest>/src/index.ts. Simple and stable.
  return `libs/${spec.replace(/^@devrev-web\//, "")}/src/index.ts`;
}

let fakeRoot: string;

beforeAll(() => {
  fakeRoot = buildFakeDevrevWeb();
});

afterAll(() => {
  fs.rmSync(fakeRoot, { recursive: true, force: true });
});

describe("runDriftAudit — synthetic tree", () => {
  it("reports no findings when the tree matches the mapping table", () => {
    const result = runDriftAudit(fakeRoot);
    expect(result.findings, formatDriftResult(result)).toEqual([]);
  });

  it("flags a missing tsconfig paths entry", () => {
    // Remove one specifier from the tsconfig so the audit can't resolve it.
    const tsconfigFile = path.join(fakeRoot, "tsconfig.base.json");
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigFile, "utf-8"));
    const droppedSpec = Object.keys(tsconfig.compilerOptions.paths)[0];
    delete tsconfig.compilerOptions.paths[droppedSpec];
    fs.writeFileSync(tsconfigFile, JSON.stringify(tsconfig, null, 2));

    const result = runDriftAudit(fakeRoot);
    expect(result.findings.some((f) => f.category === "specifier")).toBe(true);

    // Restore so other tests don't cascade.
    tsconfig.compilerOptions.paths[droppedSpec] = [specToFakePath(droppedSpec)];
    fs.writeFileSync(tsconfigFile, JSON.stringify(tsconfig, null, 2));
  });

  it("flags a missing named export", () => {
    // Empty out one specifier's index file so the expected export disappears.
    const entry = ALL_MAPPINGS.find((m) => m.production.source !== "n/a")!;
    const idx = path.join(fakeRoot, specToFakePath(entry.production.source));
    const original = fs.readFileSync(idx, "utf-8");
    fs.writeFileSync(idx, "// intentionally empty\n");

    const result = runDriftAudit(fakeRoot);
    expect(
      result.findings.some(
        (f) => f.category === "export" && f.subject.endsWith(entry.studio.name),
      ),
    ).toBe(true);

    fs.writeFileSync(idx, original);
  });

  it("flags a missing prior-art path", () => {
    const entry = ALL_MAPPINGS.find(
      (m) => m.priorArt && m.priorArt.length > 0,
    )!;
    const victim = entry.priorArt![0].path;
    const abs = path.join(fakeRoot, victim);
    fs.rmSync(abs);

    const result = runDriftAudit(fakeRoot);
    expect(
      result.findings.some(
        (f) =>
          f.category === "prior-art" &&
          f.subject.endsWith(entry.studio.name) &&
          f.detail.includes(victim),
      ),
    ).toBe(true);

    fs.writeFileSync(abs, "// fake\n");
  });

  it("flags a missing icon anchor", () => {
    const iconTypesPath = path.join(
      fakeRoot,
      "libs/shared/ui-icons/src/icon/types.ts",
    );
    const original = fs.readFileSync(iconTypesPath, "utf-8");
    // Delete the first anchor's enum member to simulate a rename in arcade-gen.
    const victim = ICON_ANCHORS[0].productionIconType;
    fs.writeFileSync(iconTypesPath, original.replace(new RegExp(`\\s*${victim}\\s*=\\s*'${victim}',`), ""));

    const result = runDriftAudit(fakeRoot);
    expect(
      result.findings.some(
        (f) => f.category === "icon-anchor" && f.subject === ICON_ANCHORS[0].studio,
      ),
    ).toBe(true);

    fs.writeFileSync(iconTypesPath, original);
  });

  it("flags a token defined only as raw HSL channels (token-resolution)", () => {
    // Overwrite the fake light-styles.css so one audited token's only
    // definition is a raw HSL triple. That's the class of drift that
    // causes inline `style={{ … var(--X) … }}` to silently invalidate.
    const lightCss = path.join(fakeRoot, "apps/product/styles/light-styles.css");
    const original = fs.readFileSync(lightCss, "utf-8");
    fs.writeFileSync(
      lightCss,
      `:root {\n  ${AUDITED_TOKENS[0]}: 0 0% 98%;\n}\n`,
    );
    const result = runDriftAudit(fakeRoot);
    expect(
      result.findings.some(
        (f) =>
          f.category === "token-resolution" &&
          f.subject === AUDITED_TOKENS[0],
      ),
    ).toBe(true);
    fs.writeFileSync(lightCss, original);
  });

  it("flags a figma-value-drift when a token's resolved color diverges from the Figma snapshot", () => {
    // Overwrite the fake light-styles.css so the first Figma-snapshot
    // token resolves to a DIFFERENT hex than the snapshot claims. The
    // actually-used snapshot token is read back so the test stays in
    // sync with whatever is committed in figma-token-values.json.
    const snapshotFile = path.join(
      __dirname,
      "..",
      "..",
      "src",
      "lift",
      "figma-token-values.json",
    );
    const figmaValues: Record<string, string> = JSON.parse(
      fs.readFileSync(snapshotFile, "utf-8"),
    );
    const snapshotToken = Object.keys(figmaValues).find(
      (k) => k.startsWith("--") && /^#[0-9a-f]{6}$/i.test(figmaValues[k]),
    );
    if (!snapshotToken) {
      // If nobody has populated a real snapshot yet, skip rather than
      // bake a false-positive expectation into the test suite.
      return;
    }
    const lightCss = path.join(fakeRoot, "apps/product/styles/light-styles.css");
    const original = fs.readFileSync(lightCss, "utf-8");
    // Pick a hex that cannot possibly equal the Figma value.
    const deliberatelyWrong = figmaValues[snapshotToken] === "#000000" ? "#ffffff" : "#000000";
    fs.writeFileSync(
      lightCss,
      `:root {\n  ${snapshotToken}: ${deliberatelyWrong};\n}\n`,
    );
    const result = runDriftAudit(fakeRoot);
    expect(
      result.findings.some(
        (f) =>
          f.category === "figma-value-drift" && f.subject === snapshotToken,
      ),
    ).toBe(true);
    fs.writeFileSync(lightCss, original);
  });
});

describe("runDriftAudit — real devrev-web (opt-in)", () => {
  // Only runs when DRIFT_AUDIT=1 is set AND the configured root exists.
  // Contributors without a devrev-web clone get green CI by default.
  const root =
    process.env.DEVREV_WEB_ROOT ||
    path.join(os.homedir(), "devrev-web");
  const enabled =
    process.env.DRIFT_AUDIT === "1" &&
    fs.existsSync(path.join(root, "tsconfig.base.json"));
  const t = enabled ? it : it.skip;

  t("produces no hard findings against the live clone", () => {
    // Hard findings are mapping-table / prior-art / icon-anchor /
    // stale-patch drifts: they always indicate a bug in THIS codebase's
    // mapping data. token-resolution and figma-value-drift findings
    // reflect the target codebase's own theme state (tokens stored as
    // raw HSL channels, Figma values out of sync with CSS). Those are
    // real and the agent must see them in the manifest, but they don't
    // fail the mapping-table audit.
    const result = runDriftAudit(root);
    const hard = result.findings.filter(
      (f) =>
        f.category !== "token-resolution" && f.category !== "figma-value-drift",
    );
    expect(hard, formatDriftResult(result)).toEqual([]);
  });
});
