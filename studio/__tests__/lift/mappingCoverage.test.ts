// studio/__tests__/lift/mappingCoverage.test.ts
//
// Coverage guard: every primitive exported via arcade-components.tsx and
// every composite/template exported by prototype-kit/index.ts MUST have
// a mapping entry. When this test fails, the fix is always to add an
// entry — never to skip, never to delete the export.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_MAPPINGS } from "../../src/lift/mappings";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PROTOTYPE_KIT = path.join(REPO_ROOT, "studio", "prototype-kit");

function readExportedNames(indexFile: string): string[] {
  const src = fs.readFileSync(indexFile, "utf-8");
  const names = new Set<string>();

  // Matches: export { A, B as C } from "..."
  const reNamedReexport = /export\s*\{([^}]+)\}\s*from\s*["'][^"']+["']\s*;?/g;
  let m: RegExpExecArray | null;
  while ((m = reNamedReexport.exec(src)) !== null) {
    for (const raw of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (raw.startsWith("type ")) continue;
      const asIdx = raw.indexOf(" as ");
      const exported = asIdx === -1 ? raw : raw.slice(asIdx + 4).trim();
      names.add(exported);
    }
  }

  // Matches: export const Foo = ..., export function Foo, etc.
  const reDecl = /export\s+(?:const|function|class)\s+([A-Za-z0-9_]+)/g;
  while ((m = reDecl.exec(src)) !== null) names.add(m[1]);

  // Matches: export { Foo } (local re-export)
  const reLocalReexport = /export\s*\{([^}]+)\}\s*;?/g;
  while ((m = reLocalReexport.exec(src)) !== null) {
    for (const raw of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (raw.startsWith("type ")) continue;
      const asIdx = raw.indexOf(" as ");
      names.add(asIdx === -1 ? raw : raw.slice(asIdx + 4).trim());
    }
  }

  return Array.from(names);
}

describe("mapping-table coverage", () => {
  it("covers every composite/template exported by prototype-kit/index.ts", () => {
    const indexFile = path.join(PROTOTYPE_KIT, "index.ts");
    const exported = readExportedNames(indexFile)
      .filter((n) => n !== "default" && !/^[a-z]/.test(n));

    const mapped = new Set(
      ALL_MAPPINGS
        .filter((m) => m.studio.source === "arcade-prototypes")
        .map((m) => m.studio.name),
    );

    const missing = exported.filter((n) => !mapped.has(n));
    expect(missing, `Unmapped prototype-kit exports: ${missing.join(", ")}`).toEqual([]);
  });

  it("covers the primitives arcade-components.tsx re-exports directly by name", () => {
    // arcade-components.tsx does `export * from "@xorkavi/arcade-gen"` plus
    // explicit named overrides (Button, IconButton). We enumerate the
    // primitive names actually referenced by composites/templates — that's
    // the reachable surface. See composites for the list.
    //
    // Icons are out of scope for the primitive mapping table (each icon
    // would be a trivial entry and they translate 1:1). We exclude them in
    // two ways: by name suffix for the common "Icon/Small/Medium/Large"
    // convention, and by an explicit allowlist for plain-noun icons that
    // arcade-gen also ships (Document, Computer, etc.). Extend this set
    // when composites pull in new plain-noun icons.
    const NON_MAPPED_ICON_NAMES = new Set([
      "AgentStudio",
      "Bell",
      "ChatBubbles",
      "Clock",
      "ClockWithDashedOutline",
      "Computer",
      "Document",
      "DotInLeftWindow",
      "DotInRightWindow",
      "Globe",
      "HumanSilhouetteWithPlus",
      "MagnifyingGlass",
      "Pencil",
      "PlusInChatBubble",
      "ThreeDotsHorizontal",
      "ThumbsDown",
      "ThumbsUp",
      "TrashBin",
      "TwoSquaresOverlapping",
    ]);
    const reachable = new Set<string>();
    const kitDir = path.join(PROTOTYPE_KIT, "composites");
    for (const f of fs.readdirSync(kitDir)) {
      if (!f.endsWith(".tsx")) continue;
      const src = fs.readFileSync(path.join(kitDir, f), "utf-8");
      // Collect names imported from "@xorkavi/arcade-gen" OR "arcade".
      const re = /import\s*\{([^}]+)\}\s*from\s*["'](?:@xorkavi\/arcade-gen|arcade|arcade\/components)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        for (const raw of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          if (raw.startsWith("type ")) continue;
          const asIdx = raw.indexOf(" as ");
          const name = asIdx === -1 ? raw : raw.slice(0, asIdx).trim();
          if (/Icon$|Small$|Medium$|Large$/.test(name)) continue;
          if (NON_MAPPED_ICON_NAMES.has(name)) continue;
          reachable.add(name);
        }
      }
    }

    const mappedPrimitives = new Set(
      ALL_MAPPINGS
        .filter((m) => m.studio.source === "arcade" || m.studio.source === "arcade/components")
        .map((m) => m.studio.name),
    );

    const missing = Array.from(reachable).filter((n) => !mappedPrimitives.has(n));
    expect(missing, `Unmapped primitives reachable from composites: ${missing.join(", ")}`).toEqual([]);
  });
});
