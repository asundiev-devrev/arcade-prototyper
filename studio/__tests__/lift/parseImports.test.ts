import { describe, it, expect } from "vitest";
import { parseImports } from "../../src/lift/parseImports";

describe("parseImports", () => {
  it("collects named imports grouped by module specifier", () => {
    const src = `
      import React from "react";
      import { Button, Input } from "arcade";
      import { Modal } from "arcade/components";
      import { NavSidebar, VistaPage } from "arcade-prototypes";
      export default function Frame() { return null; }
    `;
    const imports = parseImports(src);
    // React is excluded; only arcade-* specifiers are tracked.
    expect(imports).toEqual([
      { source: "arcade", names: ["Button", "Input"] },
      { source: "arcade/components", names: ["Modal"] },
      { source: "arcade-prototypes", names: ["NavSidebar", "VistaPage"] },
    ]);
  });

  it("merges multiple imports from the same module", () => {
    const src = `
      import { Button } from "arcade";
      import { Input } from "arcade";
    `;
    const imports = parseImports(src);
    expect(imports).toEqual([
      { source: "arcade", names: ["Button", "Input"] },
    ]);
  });

  it("ignores renamed imports by keeping the original name", () => {
    const src = `import { Button as Btn } from "arcade";`;
    const imports = parseImports(src);
    expect(imports).toEqual([{ source: "arcade", names: ["Button"] }]);
  });

  it("returns an empty array when the frame imports nothing from arcade roots", () => {
    const src = `import React from "react"; export default () => null;`;
    expect(parseImports(src)).toEqual([]);
  });
});
