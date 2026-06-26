import { describe, it, expect } from "vitest";
import { reconcileArcadeImports } from "../../../server/customize/imports";

describe("reconcileArcadeImports", () => {
  it("adds missing names to an existing arcade-gen import", () => {
    const src = `import { Button } from "@xorkavi/arcade-gen";\nexport default function F(){return null}\n`;
    const out = reconcileArcadeImports(src, ["Button", "Icon"]);
    expect(out).toMatch(/import \{ (Button, Icon|Icon, Button) \} from "@xorkavi\/arcade-gen";/);
  });
  it("inserts a new import when none exists", () => {
    const src = `export default function F(){return null}\n`;
    const out = reconcileArcadeImports(src, ["Card"]);
    expect(out).toContain(`import { Card } from "@xorkavi/arcade-gen";`);
  });
  it("is a no-op when all names already imported", () => {
    const src = `import { Button, Icon } from "@xorkavi/arcade-gen";\n`;
    expect(reconcileArcadeImports(src, ["Button"])).toBe(src);
  });
});
