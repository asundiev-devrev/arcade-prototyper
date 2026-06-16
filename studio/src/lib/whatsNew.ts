/**
 * "What's new on update" logic. Updates apply silently (electron-updater
 * auto-downloads + restarts when idle — see electron/updater.ts), so the user
 * gets NO signal that the version changed. This surfaces ONE proactive moment:
 * the first launch on a newer version, we auto-open the changelog for exactly
 * that release. After that, nothing until the next bump.
 *
 * All pure + exported so the decision is unit-tested without a DOM. The React
 * glue (localStorage + fetch + Modal) is a thin wrapper in WhatsNewModal.tsx.
 */

export const LAST_SEEN_VERSION_KEY = "arcade-studio:last-seen-version";

/**
 * Compare two `0.x.y`-style semver strings. Returns >0 if a>b, <0 if a<b, 0 if
 * equal. Non-numeric / missing segments sort as 0, so "dev" vs "0.35.1" is a
 * clean, total order (dev → [0,0,0]). Not a full semver impl (no pre-release
 * tags) — Studio versions are plain `0.MINOR.PATCH`.
 */
export function compareSemver(a: string, b: string): number {
  const seg = (v: string) => {
    const parts = (v ?? "").split(".");
    return [0, 1, 2].map((i) => {
      const n = parseInt(parts[i], 10);
      return Number.isFinite(n) ? n : 0;
    });
  };
  const pa = seg(a);
  const pb = seg(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Should we show the "what's new" modal this launch?
 *
 *  - current is missing or "dev"        → no (dev runs never nag).
 *  - stored is null (first ever launch) → no; caller records current silently.
 *    This means the FIRST version carrying this feature shows nothing (we can't
 *    know the user's prior version) — only subsequent updates do.
 *  - current > stored (a real upgrade)  → yes.
 *  - otherwise (same, or a downgrade)   → no.
 */
export function shouldShowWhatsNew(stored: string | null, current: string | null | undefined): boolean {
  if (!current || current === "dev") return false;
  if (stored === null || stored === undefined || stored === "") return false;
  return compareSemver(current, stored) > 0;
}

/**
 * Extract one version's section from the keep-a-changelog markdown — the lines
 * from its `## [x.y.z]` heading up to (not including) the next `## ` heading.
 * Returns null when the version isn't found (caller falls back to the full
 * changelog). The heading's date suffix (`## [0.35.1] — 2026-06-16`) is kept.
 */
export function extractChangelogSection(markdown: string, version: string): string | null {
  if (!markdown || !version) return null;
  const lines = markdown.split("\n");
  // Match `## [0.35.1]` with optional surrounding text on the heading line.
  const headingRe = new RegExp(`^##\\s*\\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").trim() || null;
}
