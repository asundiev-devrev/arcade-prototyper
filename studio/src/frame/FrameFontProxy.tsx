import { useInsertionEffect } from "react";

/**
 * Studio-only override for arcade's @font-face declarations.
 *
 * The production CDN (files.dev.devrev-eng.ai) Referer-whitelists its fonts,
 * so requests coming from http://localhost:5556 fail with 403
 * "Access denied. Referer not allowed." DevRevThemeProvider's injected
 * @font-face declarations point at the CDN directly and therefore never
 * load, causing headings to fall back to the system sans-serif stack.
 *
 * This component re-declares the same families pointing at the studio
 * dev server's /api/fonts proxy. Because it renders as a child of
 * DevRevThemeProvider, its useInsertionEffect runs AFTER the provider's,
 * so its @font-face rules take precedence for matching family + weight.
 */
const OVERRIDE_CSS = `
@font-face {
  font-family: "Chip Display Variable";
  src: url("/api/fonts/ChipDispVar.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "Chip Text Variable";
  src: url("/api/fonts/ChipTextVar.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "Chip Mono";
  src: url("/api/fonts/ChipMono-Regular.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "Chip Mono";
  src: url("/api/fonts/ChipMono-Medium.woff2") format("woff2");
  font-weight: 500;
  font-display: swap;
}
`.trim();

export function FrameFontProxy() {
  useInsertionEffect(() => {
    // Remove DevRevThemeProvider's CDN-pointed @font-face block so the
    // browser stops requesting ChipDispVar.woff2 from the referer-locked
    // CDN. Running as a child of the provider, this effect fires AFTER
    // the provider's own useInsertionEffect, so the element exists.
    document
      .querySelectorAll("style[data-devrev-fonts]")
      .forEach((s) => s.remove());

    const style = document.createElement("style");
    style.setAttribute("data-arcade-studio-fonts", "");
    style.textContent = OVERRIDE_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  return null;
}
