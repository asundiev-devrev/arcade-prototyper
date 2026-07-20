/**
 * Render digest — the candidate elements of a frame + their COMPUTED styles and
 * identity attributes. Consumed by render-verify: the shell reconciles the
 * user's requested property (e.g. orientation:vertical) against these real
 * computed values. See the spec:
 * docs/superpowers/specs/2026-07-20-edit-reliability-render-verify-rendered-fact-design.md
 *
 * KEY: it captures BOTH the `data-orientation` attribute (identity — how the
 * element ADVERTISES itself) and the computed `flexDirection` (the truth — how
 * it actually lays out). On a swallowed prop these DISAGREE (`data-orientation
 * ="vertical"` but `flex-direction: row`); reconcile compares the COMPUTED
 * value, so the swallow is caught.
 *
 * `measure` is injected (same as renderFingerprint) so discrimination is
 * unit-testable without a real browser. Production passes `productionMeasure`,
 * which reads the same PAINT_PROPS incl. flexDirection.
 */
import type { MeasureFn } from "./renderFingerprint";

export type DigestElement = {
  tag: string;
  dataOrientation: string | null;
  role: string | null;
  styles: Record<string, string>;
};

export type RenderDigest = { elements: DigestElement[]; truncated: boolean };

export const DIGEST_ELEMENT_CAP = 200;

const TAG_ALLOWLIST = new Set([
  "button", "input", "select", "textarea", "a",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span",
]);

/** An element worth measuring. Broad but bounded — reconcile decides relevance.
 *  A carrier of data-orientation is always in (the orientation claim's subject);
 *  an allowlisted tag or any element with an explicit role is in (color/size). */
export function isDigestCandidate(el: Element): boolean {
  if (el.hasAttribute("data-orientation")) return true;
  if (el.getAttribute("role")) return true;
  return TAG_ALLOWLIST.has(el.tagName.toLowerCase());
}

/** Walk `root` in DOM order; measure each candidate; cap the count. Recurses
 *  into non-candidates (a bare wrapper isn't measured but its children are). */
export function digestElements(
  root: Element,
  measure: MeasureFn,
  cap: number = DIGEST_ELEMENT_CAP,
): RenderDigest {
  const elements: DigestElement[] = [];
  let truncated = false;
  const walk = (el: Element): void => {
    if (elements.length >= cap) { truncated = true; return; }
    if (isDigestCandidate(el)) {
      const m = measure(el);
      if (m) {
        elements.push({
          tag: m.tag,
          dataOrientation: el.getAttribute("data-orientation"),
          role: el.getAttribute("role"),
          styles: m.style,
        });
      }
    }
    for (let i = 0; i < el.children.length; i++) {
      if (elements.length >= cap) { truncated = true; break; }
      walk(el.children[i]);
    }
  };
  walk(root);
  return { elements, truncated };
}
