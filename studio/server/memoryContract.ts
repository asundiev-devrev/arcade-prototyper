/**
 * The memory-proposal contract.
 *
 * The agent proposes a durable fact by emitting one sentinel line in its reply;
 * the server extracts it post-turn and writes it (see middleware/chat.ts). The
 * agent never touches the memory files — one writer only.
 *
 * A distinctive sentinel, not a keyword: extraction is a string match, so an
 * ordinary sentence containing "remember" can never cause a write. `→` is taken
 * by journey lines.
 *
 * Pure + regex-based on purpose: no IO, never throws.
 */
export const MEMORY_SENTINEL = "⟐ remember:";

export interface ProposedMemory {
  fact: string;
  level: "global" | "project";
}

/** One fact should be one sentence. Longer means the agent is pasting context. */
const MAX_FACT_CHARS = 200;
/** More than a few per turn means it is narrating, not distilling. */
const MAX_PER_TURN = 3;

const LINE_RE = /^[ \t]*⟐ remember:[ \t]*(.*)$/gim;

export function extractProposedMemories(text: string): ProposedMemory[] {
  if (!text.includes(MEMORY_SENTINEL)) return [];
  const out: ProposedMemory[] = [];
  for (const m of text.matchAll(LINE_RE)) {
    if (out.length >= MAX_PER_TURN) break;
    const body = (m[1] ?? "").trim();
    if (!body) continue;

    // `<level> | <fact>` — the level is optional and defaults to project.
    let level: ProposedMemory["level"] = "project";
    let fact = body;
    const bar = body.indexOf("|");
    if (bar !== -1) {
      const head = body.slice(0, bar).trim().toLowerCase();
      // Anything other than an explicit "global" contains the blast radius:
      // a wrong global fact pollutes every future project, a wrong project
      // fact stays put.
      if (head === "global") level = "global";
      fact = body.slice(bar + 1).trim();
    }

    if (!fact) continue;
    if (fact.length > MAX_FACT_CHARS) continue;
    out.push({ fact, level });
  }
  return out;
}

/**
 * Remove the sentinel lines from narration. Memory bookkeeping is silent — the
 * designer sees the summary and the Deviations section, never the plumbing.
 * Drops the whole line so no blank gap is left behind.
 */
export function stripMemoryLines(text: string): string {
  if (!text.includes(MEMORY_SENTINEL)) return text;
  return text
    .split("\n")
    .filter((line) => !/^[ \t]*⟐ remember:/i.test(line))
    .join("\n");
}
