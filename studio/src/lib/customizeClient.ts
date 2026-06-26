import type { CustomizeTarget } from "../frame/resolveCustomizeTarget";

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

// serializeTargetToSlj(iframe, target) — fiber-locate + walk
// Added in Task 9 alongside the UI wiring, since it requires a live React tree
// and is integration-tested via the manual gate (not unit-testable).
// Reuses buildWalkContext() refactored from exportFrameToSlj.ts.
