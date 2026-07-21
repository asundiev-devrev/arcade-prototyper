/**
 * Render fingerprint — a hash of a frame's AT-REST visible layout + paint.
 *
 * Used by visual-no-op detection: if an edit changes the code but the
 * fingerprint is identical across renders, the change was swallowed (a valid
 * prop the component ignores, e.g. `orientation`). See the spec:
 * docs/superpowers/specs/2026-07-17-edit-reliability-visual-noop-detection-design.md
 *
 * Deliberately does NOT hash textContent: a live clock / Date.now() / any
 * updating text would flip the hash between two renders of identical source
 * and make the check never fire. Geometry + a fixed paint set catch the target
 * class (swallowed layout/color/type props) without reading text.
 *
 * `measure` is injected so the hashing logic is unit-testable without a real
 * browser (jsdom returns all-zero rects + stub styles). Production passes
 * `productionMeasure`.
 */

export type Measured = {
  tag: string;
  rect: { x: number; y: number; w: number; h: number };
  style: Record<string, string>;
};

export type MeasureFn = (el: Element) => Measured | null;

/** Fixed set of computed paint properties hashed per element. Small + stable:
 *  enough to flip on any color/type/spacing/layout edit, cheap to resolve. */
export const PAINT_PROPS: readonly string[] = [
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "textAlign",
  "display",
  "flexDirection",
];

/** FNV-1a 32-bit, synchronous. Returns an 8-char hex string. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619, kept in 32-bit unsigned via Math.imul + >>> 0
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Walk `root`'s subtree in DOM order, serialize each measured element, hash. */
export function computeFingerprint(root: Element, measure: MeasureFn): string {
  const parts: string[] = [];
  const walk = (el: Element): void => {
    const m = measure(el);
    if (m === null) return; // excluded (e.g. status overlay) — skip it + subtree
    parts.push(
      m.tag +
        "|" +
        Math.round(m.rect.x) +
        "," +
        Math.round(m.rect.y) +
        "," +
        Math.round(m.rect.w) +
        "," +
        Math.round(m.rect.h) +
        "|" +
        PAINT_PROPS.map((p) => m.style[p] ?? "").join(","),
    );
    for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
  };
  walk(root);
  return fnv1a(parts.join(";"));
}

/**
 * Production measure: real geometry + paint. Returns `null` for the studio
 * status overlay (and its subtree) so shell chrome never enters the hash.
 * Only lands in the FRAME's <body>; picker/inspector inject to <html>/<head>.
 */
export function productionMeasure(el: Element): Measured | null {
  if (el instanceof HTMLElement && el.closest("[data-arcade-status-overlay]")) return null;
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const style: Record<string, string> = {};
  for (const p of PAINT_PROPS) style[p] = cs.getPropertyValue(cssToKebab(p)) || (cs as any)[p] || "";
  return {
    tag: el.tagName.toLowerCase(),
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    style,
  };
}

/** camelCase CSS prop → kebab-case for getPropertyValue. */
function cssToKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}
