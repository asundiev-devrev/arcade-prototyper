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
