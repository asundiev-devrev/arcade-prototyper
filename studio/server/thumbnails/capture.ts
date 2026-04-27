import { frameThumbnailPath } from "../paths";
import fs from "node:fs/promises";
import path from "node:path";

let browser: any = null;
let browserPromise: Promise<any> | null = null;
let lastUsed = 0;
const IDLE_TIMEOUT = 30000; // 30s

async function getBrowser() {
  if (browser) {
    lastUsed = Date.now();
    return browser;
  }

  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    try {
      const puppeteer = await import("puppeteer");
      browser = await puppeteer.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      lastUsed = Date.now();
      scheduleCleanup();
      return browser;
    } catch (err) {
      console.warn("[thumbnails] Puppeteer not available:", err);
      return null;
    } finally {
      browserPromise = null;
    }
  })();

  return browserPromise;
}

function scheduleCleanup() {
  setTimeout(async () => {
    if (browser && Date.now() - lastUsed > IDLE_TIMEOUT) {
      try {
        await browser.close();
      } catch (err) {
        console.warn("[thumbnails] Failed to close browser:", err);
      } finally {
        browser = null;
      }
    } else if (browser) {
      scheduleCleanup();
    }
  }, IDLE_TIMEOUT);
}

export async function captureFrameThumbnail(
  projectSlug: string,
  frameSlug: string,
  port = 5556
): Promise<string | null> {
  const outputPath = frameThumbnailPath(projectSlug, frameSlug);

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const b = await getBrowser();
    if (!b) {
      console.warn("[thumbnails] Browser not available, skipping capture");
      return null;
    }

    const page = await b.newPage();

    try {
      await page.setViewport({ width: 1280, height: 720 });

      const frameUrl = `http://localhost:${port}/frames/${projectSlug}/${frameSlug}`;

      await page.goto(frameUrl, {
        waitUntil: "networkidle2",
        timeout: 5000,
      });

      // Wait a bit for any animations
      await page.waitForTimeout(500);

      await page.screenshot({
        path: outputPath,
        type: "png",
      });

      return `thumbnails/${frameSlug}.png`;
    } finally {
      await page.close();
    }
  } catch (err) {
    console.warn(`[thumbnails] Capture failed for ${projectSlug}/${frameSlug}:`, err);
    return null;
  }
}
