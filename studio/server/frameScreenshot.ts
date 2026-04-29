import fs from "node:fs/promises";
import path from "node:path";
import type { Browser } from "playwright";
import { projectDir } from "./paths";

// Single module-scoped browser, reused across requests. Playwright's chromium
// launch is slow (~500ms), so we keep it warm and close after 60s of idle.
let browser: Browser | null = null;
let browserPromise: Promise<Browser | null> | null = null;
let lastUsedAt = 0;
const IDLE_TIMEOUT_MS = 60_000;

async function getBrowser(): Promise<Browser | null> {
  if (browser) {
    lastUsedAt = Date.now();
    return browser;
  }
  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    try {
      const { chromium } = await import("playwright");
      const b = await chromium.launch({ headless: true });
      browser = b;
      lastUsedAt = Date.now();
      scheduleIdleCleanup();
      return b;
    } catch (err) {
      console.warn("[frameScreenshot] failed to launch chromium:", err);
      return null;
    } finally {
      browserPromise = null;
    }
  })();

  return browserPromise;
}

function scheduleIdleCleanup() {
  setTimeout(async () => {
    if (!browser) return;
    if (Date.now() - lastUsedAt > IDLE_TIMEOUT_MS) {
      const b = browser;
      browser = null;
      try { await b.close(); } catch {}
    } else {
      scheduleIdleCleanup();
    }
  }, IDLE_TIMEOUT_MS + 500);
}

export interface ScreenshotOptions {
  projectSlug: string;
  frameSlug: string;
  mode: "light" | "dark";
  /** CSS pixel width to render at. Matches the frame's declared `size`. */
  width: number;
  /** Dev server port studio is listening on. */
  port: number;
}

export interface ScreenshotResult {
  /** Absolute path to the PNG on disk. Pass to the claude CLI as `@<path>`. */
  path: string;
  width: number;
  height: number;
}

/**
 * Render the frame at `/api/frames/:slug/:frame?mode=...` headlessly and write
 * a full-page PNG to `<projectDir>/_uploads/__critique/<frame>-<ts>.png`. The
 * `_uploads` path matters because it's already on the allow list for claude
 * `@<path>` references.
 */
export async function screenshotFrame(opts: ScreenshotOptions): Promise<ScreenshotResult> {
  const b = await getBrowser();
  if (!b) {
    throw new Error(
      "Headless browser unavailable. Run `pnpm exec playwright install chromium` in the repo root.",
    );
  }

  const outDir = path.join(projectDir(opts.projectSlug), "_uploads", "__critique");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${opts.frameSlug}-${Date.now()}.png`);

  const context = await b.newContext({
    viewport: { width: opts.width, height: Math.round(opts.width * 0.75) },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    const url = `http://localhost:${opts.port}/api/frames/${opts.projectSlug}/${opts.frameSlug}?mode=${opts.mode}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
    // Small settle for web fonts + any post-mount layout shifts.
    await page.waitForTimeout(400);
    const buffer = await page.screenshot({ type: "png", fullPage: true });
    await fs.writeFile(outPath, buffer);
    const viewport = page.viewportSize();
    return {
      path: outPath,
      width: viewport?.width ?? opts.width,
      height: viewport?.height ?? 0,
    };
  } finally {
    await context.close().catch(() => {});
  }
}
