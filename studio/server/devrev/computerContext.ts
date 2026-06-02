/**
 * Pure assembly of the context block sent to the Computer (DevRev agent/620)
 * on both manual @Computer summons and silent drift checks.
 *
 * agent/620 has no filesystem access, so everything it can "see" about the
 * project must be in this block. DevRev's SDK truncates payloads over ~50KB
 * to a 2KB preview, so we hard-cap the block well under that and trim the
 * lowest-signal section (raw chat history) first.
 *
 * Pure function: the middleware loads the project / frames / history and
 * passes the values in. No IO here so it's trivially testable.
 */

/** Char budget for the whole context block. Kept under DevRev's ~50KB cap
 *  with headroom for the user's own question that gets appended after it. */
export const COMPUTER_CONTEXT_BUDGET = 40_000;

export interface ComputerContextInput {
  /** One-paragraph standing brief: name, goal, what's built. */
  projectSummary: string;
  /** Objection text of pending chime-ins (already filtered to pending). */
  pendingChimeIns: string[];
  /** Pre-rendered frame source (fenced blocks), or "" if none. */
  frameSource: string;
  /** Recent user<->code-agent turns, oldest first. */
  recentHistory: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}

export function buildComputerContext(input: ComputerContextInput): string {
  const summary = `Project context\n${input.projectSummary.trim()}`;

  const notes =
    input.pendingChimeIns.length > 0
      ? `Open product-truth notes you raised earlier (unresolved):\n` +
        input.pendingChimeIns.map((o) => `- ${o}`).join("\n")
      : "";

  const frame =
    input.frameSource.trim().length > 0
      ? `Current frame source (what the code agent just built):${input.frameSource}`
      : "";

  // Build the always-on prefix first; history fills whatever budget remains.
  const fixedParts = [summary, notes, frame].filter(Boolean);
  const fixed = fixedParts.join("\n\n");

  const remaining = COMPUTER_CONTEXT_BUDGET - fixed.length - 64; // 64 = separator/header slack
  let history = "";
  if (input.recentHistory.length > 0 && remaining > 0) {
    const lines: string[] = [];
    let used = 0;
    // Walk newest -> oldest, dropping the oldest when over budget, then reverse.
    for (let i = input.recentHistory.length - 1; i >= 0; i -= 1) {
      const m = input.recentHistory[i];
      const line = `${m.role}: ${m.content}`;
      if (used + line.length > remaining) break;
      lines.push(line);
      used += line.length + 1;
    }
    if (lines.length > 0) {
      history = `Recent conversation (oldest first):\n` + lines.reverse().join("\n");
    }
  }

  const all = [fixed, history].filter(Boolean).join("\n\n");
  // Defensive final clamp (e.g. a single giant frame): never exceed budget.
  return all.length > COMPUTER_CONTEXT_BUDGET
    ? all.slice(0, COMPUTER_CONTEXT_BUDGET - 24) + "\n\n[context truncated]"
    : all;
}
