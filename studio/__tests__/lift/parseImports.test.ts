import { describe, it, expect } from "vitest";
import { parseImports } from "../../src/lift/parseImports";

describe("parseImports", () => {
  it("collects named imports grouped by module specifier, normalizing arcade/components → arcade", () => {
    const src = `
      import React from "react";
      import { Button, Input } from "arcade";
      import { Modal } from "arcade/components";
      import { NavSidebar, VistaPage } from "arcade-prototypes";
      export default function Frame() { return null; }
    `;
    const imports = parseImports(src);
    // React is excluded; only arcade-* specifiers are tracked. "arcade" and
    // "arcade/components" resolve to the same barrel at build time and are
    // collapsed into a single entry so the mapping table's "arcade"-keyed
    // entries don't miss frames authored against the "arcade/components"
    // specifier (which is what the generator's prompt template instructs).
    expect(imports).toEqual([
      { source: "arcade", names: ["Button", "Input", "Modal"] },
      { source: "arcade-prototypes", names: ["NavSidebar", "VistaPage"] },
    ]);
  });

  it("maps all arcade/components imports onto the arcade source", () => {
    // Regression: a frame that uses only "arcade/components" must still
    // produce an "arcade" entry (not an unmapped "arcade/components" one),
    // otherwise every primitive shows as _unmapped_ in the Lift Manifest.
    const src = `
      import { Button, IconButton, Avatar } from "arcade/components";
      import { AppShell } from "arcade-prototypes";
    `;
    expect(parseImports(src)).toEqual([
      { source: "arcade", names: ["Avatar", "Button", "IconButton"] },
      { source: "arcade-prototypes", names: ["AppShell"] },
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

  it("handles multiline import clauses (Prettier-style)", () => {
    // Any import with 3+ names gets wrapped by Prettier, and the generator
    // emits formatter-shaped code. The regex uses [^}] which matches newlines
    // — this test pins that contract so a future swap to `.` breaks loudly.
    const src = `import {\n  Button,\n  Input,\n  Modal,\n} from "arcade";`;
    expect(parseImports(src)).toEqual([
      { source: "arcade", names: ["Button", "Input", "Modal"] },
    ]);
  });
});
