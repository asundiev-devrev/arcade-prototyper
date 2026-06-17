/**
 * Build-time asset-catalog generator.
 *
 * Produces the two artifacts the Assets panel consumes at runtime:
 *   - studio/prototype-kit/assets-catalog.json — the catalog (composites,
 *     components, icons) with one-line docs and thumbnail paths.
 *   - studio/prototype-kit/assets-thumbs/<Name>.png — a rendered thumbnail
 *     per composite/component that has a demo example.
 *
 * How a thumbnail is rendered: each example file (examples/<Name>.tsx) exports
 * a JSX *element*, so we wrap it in a tiny frame component that default-exports
 * a React component (what the bundler expects), pack it into a self-contained
 * HTML string via packFromSource, load it in headless chromium, and screenshot
 * the FULL PAGE (portal-rendered overlays live on document.body, not #root).
 *
 * Failures never abort the run: a broken example logs a warning, gets
 * thumb=null in the catalog, and the script moves on. The end-of-run summary
 * lists every failure explicitly so a large breakage is impossible to miss.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { packFromSource } from "../server/sidecar/packFromSource";
import {
  buildCompositeSection,
  buildComponentSection,
  buildIconSection,
  type AssetItem,
} from "../server/assetsCatalog";
import { getExampleNames, EXAMPLE_OPT_OUT } from "../prototype-kit/examples/registry";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// studio/scripts/ -> studio/prototype-kit/
const KIT_ROOT = path.resolve(SCRIPT_DIR, "..", "prototype-kit");
const THUMBS_DIR = path.join(KIT_ROOT, "assets-thumbs");
const CATALOG_PATH = path.join(KIT_ROOT, "assets-catalog.json");

/** Wrap an example (a JSX element default-export) in a frame component the
 *  bundler can render as `<Frame />`. Imports the example via the bundler's
 *  `arcade-prototypes` alias so it resolves from the temp frame dir. */
function exampleFrameSource(name: string): string {
  return `import React from "react";
import example from "arcade-prototypes/examples/${name}";
export default function Frame() {
  return (
    <div style={{ padding: 24, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", boxSizing: "border-box" }}>
      {example}
    </div>
  );
}
`;
}

async function main(): Promise<void> {
  const [composites, components, icons] = await Promise.all([
    buildCompositeSection(KIT_ROOT),
    Promise.resolve(buildComponentSection()),
    buildIconSection(),
  ]);

  const exampleNames = new Set(getExampleNames());
  const optOut = new Set(EXAMPLE_OPT_OUT);

  await fs.mkdir(THUMBS_DIR, { recursive: true });

  const browser = await chromium.launch();
  let rendered = 0;
  const skipped: string[] = [];
  const failed: string[] = [];

  // Composites + components both carry renderable AssetItems with a `.thumb`.
  const renderItems: AssetItem[] = [
    ...(composites.items as AssetItem[]),
    ...(components.items as AssetItem[]),
  ];

  try {
    for (const item of renderItems) {
      const name = item.name;
      if (optOut.has(name) || !exampleNames.has(name)) {
        item.thumb = null;
        skipped.push(name);
        continue;
      }
      let page: import("playwright").Page | undefined;
      try {
        const html = await packFromSource({
          tsx: exampleFrameSource(name),
          theme: "arcade",
          mode: "light",
        });
        page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
        await page.setContent(html, { waitUntil: "networkidle" });
        // Give charts / async effects a beat to settle before capture.
        await page.waitForTimeout(400);
        // FULL PAGE — portal overlays (Modal, Select, Menu, ...) render onto
        // document.body, not #root; a #root locator would miss them.
        await page.screenshot({ path: path.join(THUMBS_DIR, `${name}.png`) });
        rendered++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ! ${name} failed to render: ${msg.split("\n")[0]}`);
        item.thumb = null;
        failed.push(name);
      } finally {
        if (page) await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }

  // No timestamp field: the catalog is a committed build artifact, so a
  // per-run `generatedAt` would churn git on every build and fight the
  // freshness test. The panel reads `sections`; provenance lives in git.
  const catalog = {
    sections: [composites, components, icons],
  };
  await fs.writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf-8");

  // Summary.
  console.log("\n=== Assets catalog built ===");
  console.log(`Composites: ${composites.items.length} items`);
  console.log(`Components: ${components.items.length} items`);
  console.log(`Icons:      ${icons.items.length} items`);
  console.log(
    `Thumbnails: ${rendered} rendered, ${failed.length} failed, ${skipped.length} skipped (opt-out / no example)`,
  );
  if (failed.length > 0) {
    console.log(`\nFAILED thumbnails (${failed.length}): ${failed.join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped (no thumbnail by design): ${skipped.join(", ")}`);
  }
  console.log(`\nCatalog: ${CATALOG_PATH}`);
  console.log(`Thumbs:  ${THUMBS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
