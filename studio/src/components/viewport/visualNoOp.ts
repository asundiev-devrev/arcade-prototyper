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

/**
 * Whether the chat controller should fire the server-owned corrective retry.
 * All four gates must hold: a no-op candidate was buffered during the turn, the
 * turn ended cleanly (`phase === "done"` — never on error/cancelled), the
 * agent's summary claimed a visual change, and we haven't already fired for
 * this originating user turn. Pure so it's testable without the component.
 */
export function shouldTriggerVisualNoOpRetry(input: {
  candidateBuffered: boolean;
  phase: "done" | "error" | "cancelled" | string;
  summaryClaimsVisual: boolean;
  alreadyTriggeredThisTurn: boolean;
}): boolean {
  if (!input.candidateBuffered) return false;
  if (input.phase !== "done") return false;
  if (!input.summaryClaimsVisual) return false;
  if (input.alreadyTriggeredThisTurn) return false;
  return true;
}

/**
 * The agent's one-sentence summary line from a turn's narrations. Drops journey
 * lines (prefixed `→ `) and stops at `### Deviations` so the visual-claim gate
 * reads the summary only, never the deviations body or server-side lines.
 */
export function firstSummaryLine(narrations: string[]): string {
  for (const raw of narrations) {
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("→")) continue;      // journey line
      if (t.startsWith("### Deviations")) return ""; // reached deviations w/o a summary
      return t;                              // first real summary line
    }
  }
  return "";
}
