// @vitest-environment node
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { parseImports } from "../../../server/hooks/validateArcadeImports.mjs";

describe("parseImports", () => {
  it("extracts named imports from arcade/components", () => {
    const src = `import { Button, IconButton } from "arcade/components";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade/components", names: ["Button", "IconButton"] },
    ]);
  });

  it("extracts named imports from arcade-prototypes", () => {
    const src = `import { AppShell } from "arcade-prototypes";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade-prototypes", names: ["AppShell"] },
    ]);
  });

  it("handles multi-line import statements", () => {
    const src = `import {\n  Button,\n  IconButton,\n  Avatar,\n} from "arcade/components";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade/components", names: ["Button", "IconButton", "Avatar"] },
    ]);
  });

  it("ignores imports from untracked sources", () => {
    const src = [
      `import React from "react";`,
      `import { useState } from "react";`,
      `import foo from "./local";`,
      `import fs from "node:fs";`,
    ].join("\n");
    expect(parseImports(src)).toEqual([]);
  });

  it("resolves 'Foo as Bar' by recording the source name Foo", () => {
    const src = `import { Button as Btn, IconButton } from "arcade/components";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade/components", names: ["Button", "IconButton"] },
    ]);
  });

  it("dedupes repeated names within a source", () => {
    const src = `import { Button } from "arcade/components";\nimport { Button, Avatar } from "arcade/components";`;
    const result = parseImports(src);
    expect(result).toHaveLength(1);
    expect(result[0].names.sort()).toEqual(["Avatar", "Button"]);
  });

  it("skips 'type'-prefixed tokens", () => {
    const src = `import { type ButtonProps, Button } from "arcade/components";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade/components", names: ["Button"] },
    ]);
  });

  it("returns [] when there are no tracked imports", () => {
    expect(parseImports(`const x = 1;`)).toEqual([]);
  });
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { loadBarrel } from "../../../server/hooks/validateArcadeImports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../../fixtures/hooks");

describe("loadBarrel", () => {
  it("extracts value exports from a machine-generated barrel", () => {
    const barrel = loadBarrel(path.join(FIXTURES, "arcade-gen/src/components/index.ts"));
    expect(barrel.has("Button")).toBe(true);
    expect(barrel.has("IconButton")).toBe(true);
    expect(barrel.has("Dialog")).toBe(true);
    // buttonVariants is a value export too, from the same line as Button.
    expect(barrel.has("buttonVariants")).toBe(true);
  });

  it("skips 'export type { ... }' type-only exports", () => {
    const barrel = loadBarrel(path.join(FIXTURES, "arcade-gen/src/components/index.ts"));
    expect(barrel.has("ButtonProps")).toBe(false);
    expect(barrel.has("IconButtonProps")).toBe(false);
    expect(barrel.has("IconProps")).toBe(false);
  });

  it("resolves 'Foo as Bar' by recording Bar (publicly importable name)", () => {
    const tmp = fs.mkdtempSync(path.join(__dirname, "tmp-barrel-"));
    try {
      const p = path.join(tmp, "index.ts");
      fs.writeFileSync(p, `export { InternalName as PublicName } from "./x.js";\n`);
      const barrel = loadBarrel(p);
      expect(barrel.has("PublicName")).toBe(true);
      expect(barrel.has("InternalName")).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns an empty Set when the file is missing", () => {
    const barrel = loadBarrel(path.join(FIXTURES, "does-not-exist.ts"));
    expect(barrel.size).toBe(0);
  });

  it("returns an empty Set when the file is empty", () => {
    const tmp = fs.mkdtempSync(path.join(__dirname, "tmp-barrel-"));
    try {
      const p = path.join(tmp, "empty.ts");
      fs.writeFileSync(p, "");
      const barrel = loadBarrel(p);
      expect(barrel.size).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("collects icon-barrel entries", () => {
    const barrel = loadBarrel(path.join(FIXTURES, "arcade-gen/src/components/icons/index.ts"));
    expect(barrel.has("ArrowsUpAndDown")).toBe(true);
    expect(barrel.has("ChevronUpAndDownSmall")).toBe(true);
    expect(barrel.has("MagnifyingGlass")).toBe(true);
  });
});

// @ts-expect-error — .mjs import of a pure-JS module with no types
import { validateImports } from "../../../server/hooks/validateArcadeImports.mjs";

describe("validateImports", () => {
  const barrels = {
    "arcade/components": new Set([
      "Button", "IconButton", "Input", "Dialog", "Avatar",
      "ArrowsUpAndDown", "ChevronUpAndDownSmall", "ArrowDownSmall",
    ]),
    "arcade-prototypes": new Set(["AppShell", "NavSidebar", "ComputerSidebar"]),
  };

  it("returns empty violations when every import exists", () => {
    const imports = [
      { source: "arcade/components", names: ["Button", "Avatar"] },
      { source: "arcade-prototypes", names: ["AppShell"] },
    ];
    expect(validateImports(imports, barrels)).toEqual([]);
  });

  it("flags a single bad name with top-3 suggestions", () => {
    const imports = [{ source: "arcade/components", names: ["ArrowsUpDownSmall"] }];
    const violations = validateImports(imports, barrels);
    expect(violations).toHaveLength(1);
    expect(violations[0].source).toBe("arcade/components");
    expect(violations[0].badName).toBe("ArrowsUpDownSmall");
    expect(violations[0].suggestions.length).toBeGreaterThan(0);
    expect(violations[0].suggestions.length).toBeLessThanOrEqual(3);
    // ArrowDownSmall is the closest (3 edits); make sure it's included.
    expect(violations[0].suggestions).toContain("ArrowDownSmall");
  });

  it("drops suggestions whose Levenshtein distance is greater than 4", () => {
    const imports = [{ source: "arcade/components", names: ["Xyzzy"] }];
    const violations = validateImports(imports, barrels);
    expect(violations).toHaveLength(1);
    // "Xyzzy" is 5+ edits away from everything in the barrel → no suggestions.
    expect(violations[0].suggestions).toEqual([]);
  });

  it("flags multiple bad names", () => {
    const imports = [{ source: "arcade/components", names: ["Button", "BadOne", "BadTwo"] }];
    const violations = validateImports(imports, barrels);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.badName).sort()).toEqual(["BadOne", "BadTwo"]);
  });

  it("flags bad names across multiple sources", () => {
    const imports = [
      { source: "arcade/components", names: ["BadIcon"] },
      { source: "arcade-prototypes", names: ["FakeComposite"] },
    ];
    const violations = validateImports(imports, barrels);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.source).sort()).toEqual(["arcade-prototypes", "arcade/components"]);
  });

  it("fails open (empty violations) when a source's barrel is empty", () => {
    const imports = [{ source: "arcade/components", names: ["ArrowsUpDownSmall"] }];
    const emptyBarrels = { "arcade/components": new Set(), "arcade-prototypes": new Set() };
    expect(validateImports(imports, emptyBarrels)).toEqual([]);
  });
});
