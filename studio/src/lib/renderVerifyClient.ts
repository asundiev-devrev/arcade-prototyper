/**
 * Client half of render-verify v3: isolation-render the BEFORE and AFTER of an
 * edited page (HTML built server-side via /api/verify-render), fingerprint each
 * in a hidden same-origin iframe, and decide no-op vs changed. Uses the shell's
 * own browser — no shipped Chromium. Mirrors captureComponentThumb. See spec.
 */
import { computeFingerprint, productionMeasure } from "../frame/renderFingerprint";

/**
 * The corrective prompt for a confirmed render no-op. Lives HERE (a browser-safe
 * module, zero node imports) — NOT in server/renderVerifyIsolation.ts, which
 * transitively pulls esbuild + a native tailwind .node addon. The client sends
 * this as the POST body prompt to the existing /api/chat/render-verify-retry
 * route; renderVerifyIsolation.ts re-exports it for server use.
 */
export const RENDER_VERIFY_CORRECTIVE_PROMPT =
  "Your last change did not alter the rendered result at all — the page renders " +
  "identically to before your edit. The property you set is being ignored by the " +
  "component. Achieve the intent a different way — a wrapper with real layout/utility " +
  "classes, or a different component — so it ACTUALLY renders. If the kit genuinely " +
  "can't do it, tell the user plainly what you couldn't do and why. Never report a " +
  "visual result the render doesn't show. Keep the response shape: a one-sentence " +
  "summary plus a ### Deviations section.";

/** Pure decision — extracted so it's unit-testable without a browser. */
export function decideNoOp(beforeFp: string | null, afterFp: string | null): "no-op" | "changed" | "skip" {
  if (!beforeFp || !afterFp) return "skip"; // fail open
  return beforeFp === afterFp ? "no-op" : "changed";
}

/** Minimum rendered text length for a render to count as non-blank. The spike
 *  saw textLen≈395 for a real page; a page that fails to mount in isolation
 *  renders near-empty. Two BLANK renders would fingerprint-EQUAL → a false
 *  "no-op" → a false corrective (the cardinal sin). So a render below this floor
 *  is treated as "couldn't render" → null → skip (fail open), NOT a no-op. */
export const NONBLANK_TEXT_FLOOR = 20;

/** Mount HTML in a hidden same-origin iframe, fingerprint its body, tear down.
 *  Null on any failure OR a blank render (fail open). Uses `srcdoc` (NOT
 *  doc.write): the bundle is an inline `<script type="module">`, and module
 *  scripts execute reliably via srcdoc but are engine-fragile via doc.write on
 *  an already-loaded iframe — a no-op write → blank render → false no-op. */
export async function renderIsolatedFingerprint(html: string): Promise<string | null> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:1295px;height:900px;border:0;visibility:hidden;";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("iso load timeout")), 8000);
      iframe.addEventListener("load", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      iframe.addEventListener("error", () => { window.clearTimeout(timer); reject(new Error("iso load error")); }, { once: true });
      iframe.srcdoc = html;             // set AFTER listeners; triggers load
      document.body.appendChild(iframe);
    });
    // settle: fonts + a couple frames (large bundle mounts async)
    await new Promise((r) => setTimeout(r, 600));
    const doc = iframe.contentDocument;
    const body = doc?.body;
    if (!body) return null;
    // Blank-render floor: a page that didn't actually mount → skip, never no-op.
    if ((body.textContent ?? "").trim().length < NONBLANK_TEXT_FLOOR) return null;
    return computeFingerprint(body, productionMeasure);
  } catch {
    return null;
  } finally {
    iframe.remove();
  }
}

async function fetchHtml(slug: string, frame: string, targetPage: string, which: "before" | "after"): Promise<string | null> {
  try {
    const res = await fetch("/api/verify-render", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, frame, targetPage, which }),
    });
    if (!res.ok) return null; // 404 no-source / 422 bundle-failed → skip
    const data = (await res.json()) as { html?: string };
    return typeof data.html === "string" ? data.html : null;
  } catch { return null; }
}

export async function verifyRenderNoOp(slug: string, frame: string, targetPage: string): Promise<"no-op" | "changed" | "skip"> {
  const [beforeHtml, afterHtml] = await Promise.all([
    fetchHtml(slug, frame, targetPage, "before"),
    fetchHtml(slug, frame, targetPage, "after"),
  ]);
  if (!beforeHtml || !afterHtml) return "skip";
  const [beforeFp, afterFp] = await Promise.all([
    renderIsolatedFingerprint(beforeHtml),
    renderIsolatedFingerprint(afterHtml),
  ]);
  return decideNoOp(beforeFp, afterFp);
}
