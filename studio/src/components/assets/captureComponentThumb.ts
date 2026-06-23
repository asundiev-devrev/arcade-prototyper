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
  // A modest viewport width so a full-width component (e.g. a pill whose
  // width caps at ~208px) lays out near its intended size in NORMAL BLOCK
  // FLOW. Do NOT use a huge width or inline-block — both distort the
  // component (stretch it full-bleed or collapse it to its text).
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:360px;height:600px;border:0;visibility:hidden;";
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
    const root = doc?.getElementById("root");
    if (!doc || !root) throw new Error("no preview document");
    // Let fonts/async layout settle and the React mount complete before
    // snapshotting. The bundle is large; a short wait avoids a blank capture.
    await new Promise((r) => setTimeout(r, 500));

    // Pad the body and crop the capture to the component's own bounding box.
    // Keep the body in NORMAL BLOCK FLOW (no inline-block) so the component
    // renders at its intended width/shape — only add padding for breathing
    // room. Then size the capture to the rendered content's height so a short
    // component isn't lost in a tall frame; the card's object-fit:contain
    // scales the result up to fill the tile, big and readable.
    const body = doc.body;
    body.style.margin = "0";
    body.style.padding = "40px";
    body.style.background = "#ffffff";
    body.style.boxSizing = "border-box";
    await new Promise((r) => setTimeout(r, 50)); // reflow after sizing change

    // Measure the rendered content (everything inside #root) so the capture
    // height hugs it plus the body padding, instead of the 600px iframe.
    const contentRect = root.getBoundingClientRect();
    const PAD = 40;
    const w = Math.max(1, Math.ceil(body.getBoundingClientRect().width));
    const h = Math.max(1, Math.ceil(contentRect.height + PAD * 2));

    const dataUrl = await toPng(body, {
      backgroundColor: "#ffffff",
      pixelRatio: 2, // crisp when the card scales it up
      width: w,
      height: h,
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
