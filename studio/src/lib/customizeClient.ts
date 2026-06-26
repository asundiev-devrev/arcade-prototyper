import type { CustomizeTarget } from "../frame/resolveCustomizeTarget";
import { buildWalkContext } from "./exportFrameToSlj";
import { sljToJsx } from "../export/sljToJsx";

export interface CustomizePayload {
  frameSlug: string; targetComponentName: string; line: number; column: number; jsx: string;
}

export function buildCustomizePayload(target: CustomizeTarget, jsx: string, frameSlug: string): CustomizePayload {
  return { frameSlug, targetComponentName: target.componentName, line: target.line, column: target.column, jsx };
}

export async function postCustomize(slug: string, payload: CustomizePayload): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`/api/customize/${slug}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return await res.json();
  } catch { return { ok: false, reason: "network" }; }
}

export async function postCustomizeUndo(slug: string, frameSlug: string): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`/api/customize/${slug}/undo`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frameSlug }),
    });
    return await res.json();
  } catch { return { ok: false }; }
}

/**
 * Locate the target component's fiber in the live iframe and serialize its
 * rendered subtree to a JSX string. Reuses buildWalkContext() (the shared
 * reader/ctx/rootFiber construction refactored out of exportFrameToSlj.ts) so
 * Customize and Figma-export walk the tree the exact same way.
 *
 * Throws if the target fiber can't be found. Integration-tested via the manual
 * gate — a live React tree isn't unit-testable.
 */
export function serializeTargetToJsx(iframe: HTMLIFrameElement, target: CustomizeTarget): string {
  const h = buildWalkContext(iframe);
  const fiber = h.findComponentFiber(target.componentName, target.line, target.column);
  if (!fiber) throw new Error("customize: target component fiber not found");
  return sljToJsx(h.walkFrom(fiber));
}

/** A short unique token used to re-find a just-customized element after reload. */
export function newCustomizeToken(): string {
  return "cz-" + Math.random().toString(36).slice(2, 8);
}

/** Insert data-arcade-customized="<token>" on the outermost JSX element of `jsx`.
 *  Matches the first `<TagName` (optionally after leading whitespace) and inserts
 *  the attr right after the tag name. Returns `jsx` unchanged if no root tag. */
export function markJsxRoot(jsx: string, token: string): string {
  // first `<` + tag name (letters/numbers/dot for Foo.Bar), capture up to end of tag name
  const m = /^(\s*<)([A-Za-z][\w.]*)/.exec(jsx);
  if (!m) return jsx;
  const insertAt = m[1].length + m[2].length; // after `<TagName`
  return jsx.slice(0, insertAt) + ` data-arcade-customized="${token}"` + jsx.slice(insertAt);
}
