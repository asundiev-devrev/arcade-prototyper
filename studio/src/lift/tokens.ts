// studio/src/lift/tokens.ts
//
// Token + utility-class patch table for the lift manifest.
//
// The original plan expected production and arcade-gen to converge to the
// same token names over time. While that migration is in flight, frames
// ship with names that don't resolve 1:1 in devrev-web. Rather than lying
// in the manifest ("tokens alignment: aligned"), we emit a PATCH per
// entry that actually appears in the frame source.
//
// Entries are **self-sunsetting**: the drift audit (src/lift/drift.ts)
// removes any entry whose `studio` side no longer exists in arcade-gen's
// shipped stylesheets. When the patch table goes empty, the renderer
// stops emitting the <tokens> element entirely (resolving follow-up #5
// from docs/plans/2026-05-05-lift-manifest-followups.md).
//
// See docs/plans/2026-05-12-lift-manifest-pr6-revision.md for the broader
// PR 6 scope that added utility-class patches alongside token patches.

export interface Patch {
  /** Name as it appears in arcade-gen output (what the frame source will contain). */
  studio: string;
  /** Name the downstream agent should write into the devrev-web lift instead. */
  production: string;
  /**
   * Which arcade-gen stylesheet the `studio` side is expected to live in.
   * The drift audit confirms it's still there; when absent, the entry is
   * stale and should be deleted from this table.
   * Paths are relative to the @xorkavi/arcade-gen package root.
   */
  sunset_if_absent_from: "dist/tokens.css" | "dist/styles.css";
  /** One-line reason for the patch — shown to reviewers when stale. */
  reason?: string;
}

/**
 * CSS custom property patches. Used inside `style={{ color: 'var(--…)' }}`
 * and similar inline styles in the frame source.
 */
export const TOKEN_PATCHES: Patch[] = [
  {
    studio: "--surface-overlay",
    production: "--bg-surface-overlay",
    sunset_if_absent_from: "dist/tokens.css",
    reason:
      "devrev-web renamed to --bg-surface-overlay during the 2026 token sweep; arcade-gen not yet caught up.",
  },
];

/**
 * Tailwind utility-class patches. Arcade-gen ships a small set of
 * component-shorthand utilities that don't exist in devrev-web's
 * Tailwind config.
 */
export const CLASS_PATCHES: Patch[] = [
  {
    studio: "rounded-square-x2",
    production: "rounded-lg",
    sunset_if_absent_from: "dist/styles.css",
    reason:
      "arcade-gen shorthand; devrev-web Tailwind config has no corresponding utility.",
  },
  {
    studio: "rounded-square",
    production: "rounded-md",
    sunset_if_absent_from: "dist/styles.css",
    reason:
      "arcade-gen shorthand; devrev-web Tailwind config has no corresponding utility.",
  },
];

/**
 * Scan a frame's source text and return only the patches that actually
 * appear in it. Keeps the manifest's <tokens> element tight — no
 * filler for frames that don't need any of these.
 */
export function applicablePatches(frameSource: string): {
  tokenPatches: Patch[];
  classPatches: Patch[];
} {
  const tokenPatches = TOKEN_PATCHES.filter((p) =>
    frameSource.includes(p.studio),
  );
  // Utility classes need word-boundary matching so "rounded-square" doesn't
  // fire on "rounded-square-x2". Regex is built at match time because the
  // names are short, controlled, and don't need caching.
  const classPatches = CLASS_PATCHES.filter((p) => {
    const re = new RegExp(`(?:^|[\\s"'])${escapeRegex(p.studio)}(?:$|[\\s"'])`);
    return re.test(frameSource);
  });
  return { tokenPatches, classPatches };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
