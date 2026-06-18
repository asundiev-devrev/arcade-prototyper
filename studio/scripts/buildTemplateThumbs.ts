/**
 * Render each homepage-template seed (.tsx) to a wide PNG thumbnail.
 * Pack the seed into self-contained HTML via packFromSource, load it in
 * headless chromium, and screenshot full-page. Committed PNGs mean dev mode
 * and tests never run Playwright. Wired into studio:pack / studio:release.
 *
 * Run: pnpm run studio:templates
 */
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { packFromSource } from "../server/sidecar/packFromSource";
import { TEMPLATES, readTemplateSeed, TEMPLATE_THUMBS_DIR } from "../server/templates";

async function main() {
  await fs.mkdir(TEMPLATE_THUMBS_DIR, { recursive: true });
  const browser = await chromium.launch();
  const failed: string[] = [];
  try {
    for (const t of TEMPLATES) {
      let page;
      try {
        const html = await packFromSource({ tsx: await readTemplateSeed(t.id), theme: "arcade", mode: "light" });
        // Wide page preview (16:9-ish) — show the full layout, not a crop.
        page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await page.setContent(html, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(TEMPLATE_THUMBS_DIR, t.thumb) });
        console.log(`  ✓ ${t.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ! ${t.id} failed: ${msg.split("\n")[0]}`);
        failed.push(t.id);
      } finally {
        if (page) await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
  if (failed.length) {
    console.error(`Failed to render: ${failed.join(", ")}`);
    process.exit(1);
  }
}

void main();
