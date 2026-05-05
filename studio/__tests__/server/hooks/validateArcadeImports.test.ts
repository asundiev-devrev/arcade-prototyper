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

// @ts-expect-error — .mjs import of a pure-JS module with no types
import { formatErrorMessage } from "../../../server/hooks/validateArcadeImports.mjs";

describe("formatErrorMessage", () => {
  const barrels = {
    "arcade/components": new Set(["Button", "IconButton", "ArrowsUpAndDown"]),
    "arcade-prototypes": new Set(["AppShell", "ComputerSidebar"]),
  };
  const barrelPaths = {
    "arcade/components": "/abs/arcade-gen/src/components/index.ts",
    "arcade-prototypes": "/abs/studio/prototype-kit/index.ts",
  };

  it("includes a per-source group header", () => {
    const msg = formatErrorMessage(
      [{ source: "arcade/components", badName: "FakeIcon", suggestions: ["ArrowsUpAndDown"] }],
      barrels, barrelPaths,
    );
    expect(msg).toContain(`In "arcade/components"`);
  });

  it("includes the top-3 suggestions inline", () => {
    const msg = formatErrorMessage(
      [{ source: "arcade/components", badName: "FakeIcon",
        suggestions: ["ArrowsUpAndDown", "IconButton", "Button"] }],
      barrels, barrelPaths,
    );
    expect(msg).toMatch(/did you mean.+ArrowsUpAndDown/i);
    expect(msg).toContain("IconButton");
    expect(msg).toContain("Button");
  });

  it("shows the barrel path when no suggestion meets the threshold", () => {
    const msg = formatErrorMessage(
      [{ source: "arcade/components", badName: "Xyzzy", suggestions: [] }],
      barrels, barrelPaths,
    );
    expect(msg).toContain("/abs/arcade-gen/src/components/index.ts");
    expect(msg).toContain("3 exports"); // includes size
  });

  it("groups multiple violations by source", () => {
    const msg = formatErrorMessage(
      [
        { source: "arcade/components", badName: "A", suggestions: ["Button"] },
        { source: "arcade/components", badName: "B", suggestions: ["IconButton"] },
        { source: "arcade-prototypes", badName: "C", suggestions: ["AppShell"] },
      ],
      barrels, barrelPaths,
    );
    expect(msg).toMatch(/In "arcade\/components".+\n.+A.+\n.+B/s);
    expect(msg).toMatch(/In "arcade-prototypes".+\n.+C/s);
  });
});

import { spawnSync } from "node:child_process";

const HOOK = path.resolve(__dirname, "../../../server/hooks/validateArcadeImports.mjs");

function runHook(payload, envOverrides = {}) {
  return spawnSync("node", [HOOK], {
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      ARCADE_GEN_ROOT: path.join(FIXTURES, "arcade-gen"),
      ARCADE_PROTOTYPER_ROOT: FIXTURES,
      ...envOverrides,
    },
    encoding: "utf-8",
  });
}

describe("validateArcadeImports hook (integration)", () => {
  it("exits 0 when file_path is outside a .tsx file", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/foo.css",
        content: `import { BadIcon } from "arcade/components";`,
      },
    });
    expect(proc.status).toBe(0);
  });

  it("exits 0 when the file has no tracked imports", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        content: `import React from "react";\nexport default () => null;`,
      },
    });
    expect(proc.status).toBe(0);
  });

  it("exits 0 when all imports are valid", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        content: `import { Button, IconButton } from "arcade/components";\nimport { AppShell } from "arcade-prototypes";`,
      },
    });
    expect(proc.status).toBe(0);
  });

  it("exits 2 with a human-readable stderr on a bad import", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        content: `import { ArrowsUpDownSmall } from "arcade/components";`,
      },
    });
    expect(proc.status).toBe(2);
    expect(proc.stderr).toMatch(/Blocked/);
    expect(proc.stderr).toMatch(/ArrowsUpDownSmall/);
    expect(proc.stderr).toMatch(/did you mean/i);
    expect(proc.stderr).toMatch(/ArrowDownSmall/);
  });

  it("validates the new_string field for Edit tool calls", () => {
    const proc = runHook({
      tool_name: "Edit",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        old_string: `import { Button } from "arcade/components";`,
        new_string: `import { Button, ArrowsUpDownSmall } from "arcade/components";`,
      },
    });
    expect(proc.status).toBe(2);
    expect(proc.stderr).toMatch(/ArrowsUpDownSmall/);
  });

  it("fails open (exit 0) when barrels cannot be read", () => {
    const proc = runHook(
      {
        tool_name: "Write",
        tool_input: {
          file_path: "/tmp/frame.tsx",
          content: `import { ArrowsUpDownSmall } from "arcade/components";`,
        },
      },
      { ARCADE_GEN_ROOT: "/nonexistent/path", ARCADE_PROTOTYPER_ROOT: "/nonexistent/path" },
    );
    expect(proc.status).toBe(0);
  });

  it("fails open on malformed JSON input", () => {
    const proc = spawnSync("node", [HOOK], {
      input: "not json",
      env: { ...process.env, ARCADE_GEN_ROOT: path.join(FIXTURES, "arcade-gen") },
      encoding: "utf-8",
    });
    expect(proc.status).toBe(0);
  });
});

// @ts-expect-error — .mjs import of a pure-JS module with no types
import {
  stripCommentsAndStrings,
  extractJsxComponentNames,
  collectDefinedIdentifiers,
  validateJsxReferences,
} from "../../../server/hooks/validateArcadeImports.mjs";

describe("stripCommentsAndStrings", () => {
  it("removes line comments", () => {
    expect(stripCommentsAndStrings("a // <Foo />\nb")).not.toContain("<Foo");
  });
  it("removes block comments", () => {
    expect(stripCommentsAndStrings("/* <Foo /> */ x")).not.toContain("<Foo");
  });
  it("preserves code outside strings", () => {
    const src = `const x = "<Foo />"; <Bar/>`;
    expect(stripCommentsAndStrings(src)).toContain("<Bar/>");
  });
  it("removes JSX-looking content inside a string literal", () => {
    const src = `const label = "<FakeComposite />";`;
    expect(extractJsxComponentNames(stripCommentsAndStrings(src))).toEqual([]);
  });
  it("keeps template-literal ${expr} substitutions visible", () => {
    const src = "const s = `hello ${<Inner />}`;";
    const out = stripCommentsAndStrings(src);
    expect(out).toContain("<Inner />");
  });
});

describe("extractJsxComponentNames", () => {
  it("finds a bare JSX opener", () => {
    expect(extractJsxComponentNames("return <Foo />;")).toEqual(["Foo"]);
  });
  it("finds multiple, deduped", () => {
    const src = `<A><B /><A /></A>`;
    expect(extractJsxComponentNames(src).sort()).toEqual(["A", "B"]);
  });
  it("records the root of a member expression", () => {
    expect(extractJsxComponentNames("<Menu.Item />")).toEqual(["Menu"]);
  });
  it("ignores lowercase tags (host elements)", () => {
    expect(extractJsxComponentNames("<div><span/></div>")).toEqual([]);
  });
  it("does not confuse TS generics for JSX (e.g. useState<Foo>())", () => {
    const src = `const x = useState<MyType>();`;
    expect(extractJsxComponentNames(src)).toEqual([]);
  });
  it("does not confuse a type alias like Record<X> for JSX", () => {
    const src = `type Y = Record<Key, Value>;`;
    expect(extractJsxComponentNames(src)).toEqual([]);
  });
  it("captures opener preceded by '('", () => {
    expect(extractJsxComponentNames("render(<Foo />)")).toEqual(["Foo"]);
  });
});

describe("collectDefinedIdentifiers", () => {
  it("includes named imports", () => {
    const defined = collectDefinedIdentifiers(`import { Foo, Bar as Baz } from "x";`);
    expect(defined.has("Foo")).toBe(true);
    expect(defined.has("Baz")).toBe(true);
    expect(defined.has("Bar")).toBe(false);
  });
  it("includes default and namespace imports", () => {
    const defined = collectDefinedIdentifiers(
      `import React from "react";\nimport * as Icons from "icons";`,
    );
    expect(defined.has("React")).toBe(true);
    expect(defined.has("Icons")).toBe(true);
  });
  it("includes function, class, and const declarations", () => {
    const defined = collectDefinedIdentifiers(
      `function MyFn() {}\nexport class MyClass {}\nconst MyConst = 1;`,
    );
    expect(defined.has("MyFn")).toBe(true);
    expect(defined.has("MyClass")).toBe(true);
    expect(defined.has("MyConst")).toBe(true);
  });
});

describe("validateJsxReferences", () => {
  const barrel = new Set([
    "AppShell", "NavSidebar", "Button", "IconButton", "VistaPage",
  ]);

  it("returns [] when every JSX name resolves", () => {
    const src = `
      import { AppShell, NavSidebar } from "arcade-prototypes";
      function Local() { return <div />; }
      export default () => (
        <AppShell sidebar={<NavSidebar />}>
          <Local />
        </AppShell>
      );
    `;
    expect(validateJsxReferences(src, barrel)).toEqual([]);
  });

  it("flags an undeclared JSX reference with a Did-you-mean", () => {
    // Mirrors the beta-tester crash: WindowWithGrid is used as JSX but
    // nothing is imported for it and nothing is declared in the file.
    const src = `
      import { AppShell } from "arcade-prototypes";
      export default () => (
        <AppShell>
          <WindowWithGrid />
        </AppShell>
      );
    `;
    const violations = validateJsxReferences(src, new Set([...barrel, "AppShell"]));
    expect(violations).toHaveLength(1);
    expect(violations[0].name).toBe("WindowWithGrid");
  });

  it("does not flag locally declared components", () => {
    const src = `
      function LocalThing() { return <div />; }
      export default () => <LocalThing />;
    `;
    expect(validateJsxReferences(src, barrel)).toEqual([]);
  });

  it("does not flag member-expression JSX whose root is imported", () => {
    const src = `
      import { AppShell } from "arcade-prototypes";
      export default () => <AppShell.Header />;
    `;
    expect(validateJsxReferences(src, new Set([...barrel]))).toEqual([]);
  });

  it("fails open when the merged barrel is empty", () => {
    const src = `export default () => <UndefinedThing />;`;
    expect(validateJsxReferences(src, new Set())).toEqual([]);
  });

  it("does not mistake a string literal for JSX", () => {
    const src = `
      const label = "<Ghost />";
      export default () => <div>{label}</div>;
    `;
    expect(validateJsxReferences(src, barrel)).toEqual([]);
  });
});

describe("validateArcadeImports hook — JSX reference integration", () => {
  it("blocks a frame that uses <WindowWithGrid /> without importing it", () => {
    // The exact shape from the beta-tester crash: import looks valid, but
    // the generator dropped an invented composite name into the JSX.
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        content: [
          `import { AppShell, NavSidebar } from "arcade-prototypes";`,
          `export default function MyWorkPage() {`,
          `  return (`,
          `    <AppShell sidebar={<NavSidebar />}>`,
          `      <WindowWithGrid />`,
          `    </AppShell>`,
          `  );`,
          `}`,
        ].join("\n"),
      },
    });
    expect(proc.status).toBe(2);
    expect(proc.stderr).toMatch(/WindowWithGrid/);
    expect(proc.stderr).toMatch(/JSX/i);
  });

  it("allows a frame whose JSX names all resolve to imports", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/frame.tsx",
        content: [
          `import { AppShell, NavSidebar } from "arcade-prototypes";`,
          `import { Button } from "arcade/components";`,
          `export default function Page() {`,
          `  return (`,
          `    <AppShell sidebar={<NavSidebar />}>`,
          `      <Button>click</Button>`,
          `    </AppShell>`,
          `  );`,
          `}`,
        ].join("\n"),
      },
    });
    expect(proc.status).toBe(0);
  });

  it("does not run the JSX check on .ts files (type casts look like JSX)", () => {
    const proc = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: "/tmp/helper.ts",
        content: `export const asNode = (x: unknown) => x as { foo: string };`,
      },
    });
    expect(proc.status).toBe(0);
  });
});
