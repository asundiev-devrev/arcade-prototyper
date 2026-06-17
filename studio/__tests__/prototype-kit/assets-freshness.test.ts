import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompositeSection, buildComponentSection } from "../../server/assetsCatalog";
import { EXAMPLE_OPT_OUT, getExampleNames } from "../../prototype-kit/examples/registry";

const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "prototype-kit",
);
const CATALOG_PATH = path.join(KIT_ROOT, "assets-catalog.json");

interface CatalogItem { name: string; thumb?: string | null }
interface CatalogSection { kind: string; items: CatalogItem[] }
interface Catalog { sections: CatalogSection[] }

function readCatalog(): Catalog {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8"));
}

describe("assets catalog freshness", () => {
  it("committed catalog exists", () => {
    expect(fs.existsSync(CATALOG_PATH), "run `pnpm run studio:assets`").toBe(true);
  });

  it("catalog composite + component names match the live sources", async () => {
    const catalog = readCatalog();
    const sectionNames = (kind: string) =>
      new Set(
        (catalog.sections.find((s) => s.kind === kind)?.items ?? []).map((i) => i.name),
      );

    const liveComposites = new Set(
      ((await buildCompositeSection(KIT_ROOT)).items as { name: string }[]).map((i) => i.name),
    );
    const liveComponents = new Set(
      (buildComponentSection().items as { name: string }[]).map((i) => i.name),
    );

    expect(
      sectionNames("composite"),
      "catalog composite names drifted from sources — run `pnpm run studio:assets`",
    ).toEqual(liveComposites);
    expect(
      sectionNames("component"),
      "catalog component names drifted from sources — run `pnpm run studio:assets`",
    ).toEqual(liveComponents);
  });

  it("every catalog composite/component has a thumb path unless opted out", () => {
    const catalog = readCatalog();
    const optOut = new Set(EXAMPLE_OPT_OUT);
    const examples = new Set(getExampleNames());
    for (const kind of ["composite", "component"]) {
      const section = catalog.sections.find((s) => s.kind === kind);
      for (const item of section?.items ?? []) {
        const shouldHaveThumb = examples.has(item.name) && !optOut.has(item.name);
        if (shouldHaveThumb) {
          expect(item.thumb, `${item.name} should have a thumb`).toBeTruthy();
        } else {
          expect(item.thumb ?? null, `${item.name} should be null (opted out / no example)`).toBeNull();
        }
      }
    }
  });
});
