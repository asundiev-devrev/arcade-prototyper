/**
 * Visual-no-op detection: an edit changed the code but the rendered frame is
 * pixel-identical to the prior render. See the spec.
 *
 * NONCE-KEYED, not editCycleActive-keyed. Rationale (plan review, rev-4): the
 * fingerprint message arrives AFTER `frame-ready` (it awaits fonts+rAF), by
 * which point the double-buffer swap has already cleared `editCycleActive`. So
 * we cannot read that flag to decide "is this the in-flight probe?" — we key on
 * the nonce instead: a fingerprint whose nonce differs from the baseline's is a
 * NEW render (compare it); a same-nonce fingerprint just refreshes the baseline
 * (a render is never compared against itself → no self-poison).
 */

export function isVisualNoOp(
  probeFp: string | null | undefined,
  baselineFp: string | null | undefined,
): boolean {
  if (!probeFp || !baselineFp) return false;
  return probeFp === baselineFp;
}

export type FpTracker = { baseline: { fp: string; nonce: string } | null };

/**
 * Fold one `frame-fingerprint` into the tracker. Returns what it meant:
 *   "captured" — no baseline yet, or same-nonce refresh (no comparison made)
 *   "no-op"    — a new-nonce render whose fp equals the baseline (candidate!)
 *   "changed"  — a new-nonce render whose fp differs (a real visible change)
 * In all NEW-nonce cases the baseline is promoted to this render, so the next
 * edit compares against the latest committed pixels. Mutates `tracker.baseline`.
 */
export function observeFingerprint(
  tracker: FpTracker,
  fp: string,
  nonce: string,
): "captured" | "no-op" | "changed" {
  const prev = tracker.baseline;
  if (!prev || prev.nonce === nonce) {
    // First render, or a re-measure of the SAME render → refresh, never compare.
    tracker.baseline = { fp, nonce };
    return "captured";
  }
  const result = isVisualNoOp(fp, prev.fp) ? "no-op" : "changed";
  tracker.baseline = { fp, nonce }; // promote so the next edit compares vs this
  return result;
}
