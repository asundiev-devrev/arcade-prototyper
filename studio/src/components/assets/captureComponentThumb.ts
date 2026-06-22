import { toPng } from "html-to-image";

/**
 * Capture a PNG thumbnail of a saved component and persist it.
 *
 * Why this exists: shipped composites get their thumbnails rendered at build
 * time with Playwright, which is NOT in the packaged DMG. User components are
 * created at runtime on a tester's machine, so we render them here instead —
 * load the component's rendered HTML (served by /api/components/<name>/preview,
 * which reuses the shipped esbuild+Tailwind bundler) into ONE transient hidden
 * iframe, rasterize its body to a PNG via html-to-image (the renderer's own
 * Chromium canvas — no native deps), POST the PNG, then tear the iframe down.
 *
 * The iframe is same-origin (served by our own dev/middleware server), so the
 * parent can reach into its document to rasterize. It never persists — exactly
 * one short-lived iframe per save, removed in `finally`.
 *
 * Best-effort: a capture failure is swallowed (the card falls back to its
 * name-only placeholder). It must never block or fail the save itself.
 */
export async function captureComponentThumb(name: string): Promise<boolean> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // Offscreen but laid out at a real size so the component paints. A 4:3 box
  // matches the card's aspect ratio.
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:480px;height:360px;border:0;visibility:hidden;";
  iframe.src = `/api/components/${encodeURIComponent(name)}/preview`;
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("preview load timeout")), 8000);
      iframe.addEventListener(
        "load",
        () => { window.clearTimeout(timer); resolve(); },
        { once: true },
      );
      iframe.addEventListener(
        "error",
        () => { window.clearTimeout(timer); reject(new Error("preview load error")); },
        { once: true },
      );
    });

    const doc = iframe.contentDocument;
    const target = doc?.body;
    if (!doc || !target) throw new Error("no preview document");
    // Center the rendered component within the capture box. The preview body
    // otherwise top-aligns its content, leaving dead space below short/wide
    // components (e.g. a pill). Flex-centering both axes frames it like the
    // shipped-composite thumbnails.
    target.style.margin = "0";
    // Explicit height (not just min-height) is required for flex vertical
    // centering — short components (e.g. a 21px pill) otherwise pin to the top.
    target.style.height = "360px";
    target.style.display = "flex";
    target.style.alignItems = "center";
    target.style.justifyContent = "center";
    // Let fonts/async layout settle (and the React mount complete) before
    // snapshotting. The bundle is large; a short wait avoids a blank capture.
    await new Promise((r) => setTimeout(r, 500));

    const dataUrl = await toPng(target, {
      backgroundColor: "#ffffff",
      pixelRatio: 1,
      width: 480,
      height: 360,
    });

    const png = await (await fetch(dataUrl)).blob();
    const res = await fetch(`/api/components/${encodeURIComponent(name)}/thumb`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    return res.ok;
  } catch {
    return false; // best-effort; placeholder remains
  } finally {
    iframe.remove();
  }
}
