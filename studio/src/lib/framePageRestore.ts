/**
 * Return-to-your-page helper for the double-buffer swap.
 *
 * The resilient-render swap remounts the committed iframe so an edit shows
 * without a manual refresh (commit 47d0d24). But arcade frames are client-routed
 * multi-page apps that hold the active page in React state with NO persistence
 * (e.g. `const [active] = useState("my-computer")`), so a remount resets them to
 * their default page — an edit made on a sub-page lands off-screen until the user
 * re-navigates (confirmed live). See render-measurement-multipage-blocker memory.
 *
 * This is a best-effort, component-agnostic restore: BEFORE the swap we record
 * the visible page's heading; AFTER the remount we click the nav control whose
 * label matches, returning the user to where they were. It reads the frame's own
 * rendered DOM only — it does NOT touch the generated frames or @xorkavi/arcade-gen.
 *
 * DELIBERATE LIMITS (graceful no-op, never worse than today's default-page reset):
 *  - Matches an interactive nav control by EXACT trimmed label == the page heading.
 *    Relies on the common sidebar/pages pattern where the nav label equals the
 *    page heading. When they differ, or the page has no labeled nav control, or
 *    the label is ambiguous, no control matches → we leave the frame on its
 *    default page (exactly the pre-fix behavior).
 *  - Exact match only. A fuzzy/startsWith match could click the WRONG page — far
 *    worse than staying put — so we never do it.
 */

/** The active page's identifying label: the first heading in the rendered frame.
 *  Null when there's no heading (→ nothing to capture, restore is skipped). */
export function currentPageLabel(doc: Document | null | undefined): string | null {
  const h = doc?.querySelector("h1, h2");
  const text = h?.textContent?.trim();
  return text ? text : null;
}

/** Find the interactive nav control whose exact trimmed label matches `label`,
 *  or null. Restricted to genuinely clickable roles so a non-interactive
 *  breadcrumb/heading with the same text is never picked. First match wins
 *  (duplicate nav labels are rare, and any control with the label navigates to
 *  the same page). */
export function findRestoreTarget(
  doc: Document | null | undefined,
  label: string | null,
): HTMLElement | null {
  if (!doc || !label) return null;
  const candidates = doc.querySelectorAll<HTMLElement>(
    'button, a[href], [role="button"], [role="tab"], [role="menuitem"]',
  );
  for (const el of candidates) {
    if ((el.textContent ?? "").trim() === label) return el;
  }
  return null;
}
