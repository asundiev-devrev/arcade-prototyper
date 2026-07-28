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
 *
 * Two invariants hold this file together, because breaking either one is a
 * user-visible bug rather than a style nit:
 *
 *  1. `extractProposedMemories` and `stripMemoryLines` share ONE line scanner
 *     and ONE line matcher. If they could disagree, every disagreement is a
 *     bug: match-but-no-strip leaks the plumbing line into the designer's chat
 *     pane; strip-but-no-match silently drops a memory the agent proposed.
 *  2. What the agent writes is markdown, so the sentinel arrives wrapped in
 *     markdown — backticked, bulleted, bolded, quoted. Decoration must not
 *     decide whether memory works.
 */
export const MEMORY_SENTINEL = "⟐ remember:";

/** The caseless glyph — a cheap early-out that cannot disagree with the regex. */
const SENTINEL_GLYPH = "⟐";

export interface ProposedMemory {
  fact: string;
  level: "global" | "project";
}

/** One fact should be one sentence. Longer means the agent is pasting context. */
const MAX_FACT_CHARS = 200;
/** More than a few per turn means it is narrating, not distilling. */
const MAX_PER_TURN = 3;
/** Shorter than this cannot be a preference. */
const MIN_FACT_CHARS = 3;

/**
 * Every terminator JS regex `^`/`$` in multiline mode treat as a line break —
 * including U+2028/U+2029, which arrive routinely in text pasted out of design
 * tools. Splitting and matching must agree on what a line is.
 */
const LINE_SPLIT_RE = /(\r\n|[\n\r\u2028\u2029])/;

/**
 * Leading markdown decoration the agent may put in front of the sentinel:
 * blockquote markers, list bullets, emphasis, code fences.
 */
const SENTINEL_LINE_RE = /^[ \t>*_`~+-]*⟐[ \t]*remember:(.*)$/i;

/** Emphasis/code characters to shave off the body's two ends (never `.` — a fact may end in a period). */
const EDGE_DECORATION_RE_START = /^[\s*_`~]+/;
const EDGE_DECORATION_RE_END = /[\s*_`~]+$/;

/**
 * A level head is only a level when it looks like one: a single bare word.
 * `⟐ remember: Dialog footers read "Cancel | Save"` must keep its whole fact —
 * treating everything before the first pipe as a level truncated it to `Save"`.
 */
const LEVEL_HEAD_RE = /^[a-z]{1,16}$/;

/**
 * Null-content answers. The memory line lives in the required response shape
 * next to `### Deviations`, whose convention is to fill the slot with "None." —
 * so slot-filling is the predictable failure, not an edge case. Each of these
 * would otherwise become a permanent standing instruction.
 */
const NULL_FACTS = new Set([
  "none",
  "no",
  "na",
  "n a",
  "nil",
  "tbd",
  "nothing",
  "global",
  "project",
]);

/**
 * An angle-bracket placeholder — `<global|project>`, `<the preference, one
 * short sentence>`. The response-shape instruction has to show the line's
 * literal shape, and an LLM echoing a format example verbatim is ordinary
 * behaviour, not an edge case. Without this guard the template's own example
 * parses as a real memory and becomes a permanent standing instruction that
 * gets injected into every later turn — with no UI cue explaining why.
 *
 * Costs us any genuine fact that contains a `<…>` pair (e.g. one naming a raw
 * HTML tag). That is the right trade: such a fact is implementation detail the
 * prompt already tells the agent not to record, and losing one memory is far
 * cheaper than writing garbage into permanent memory.
 */
const PLACEHOLDER_RE = /<[^<>]*>/;

/** Lowercase, punctuation-free, single-spaced — so "None." and "N/A" collapse onto the denylist. */
function normalizeForNullCheck(fact: string): string {
  return fact
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isNullContent(fact: string): boolean {
  // Check the RAW fact first: normalization strips the brackets, so a
  // placeholder must be spotted before punctuation is thrown away.
  if (PLACEHOLDER_RE.test(fact)) return true;
  const n = normalizeForNullCheck(fact);
  if (!n || n.length < MIN_FACT_CHARS) return true;
  if (NULL_FACTS.has(n)) return true;
  // "nothing durable this turn", "none this turn", "no memory needed" — the
  // agent narrating its own silence instead of staying silent.
  if (/^nothing\b/.test(n)) return true;
  if (/^none\b/.test(n)) return true;
  if (/^no (memor|memories|preference|durable|new)/.test(n)) return true;
  return false;
}

/** The single line matcher. Returns the raw body after the sentinel, or null. */
function matchSentinelLine(line: string): string | null {
  const m = SENTINEL_LINE_RE.exec(line);
  return m ? (m[1] ?? "") : null;
}

/** Split into lines while keeping each line's own terminator. */
function splitLines(text: string): { line: string; term: string }[] {
  const parts = text.split(LINE_SPLIT_RE);
  const out: { line: string; term: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    out.push({ line: parts[i] ?? "", term: parts[i + 1] ?? "" });
  }
  return out;
}

export function extractProposedMemories(text: string): ProposedMemory[] {
  if (!text.includes(SENTINEL_GLYPH)) return [];
  const out: ProposedMemory[] = [];
  for (const { line } of splitLines(text)) {
    if (out.length >= MAX_PER_TURN) break;
    const raw = matchSentinelLine(line);
    if (raw === null) continue;

    const body = raw.replace(EDGE_DECORATION_RE_START, "").replace(EDGE_DECORATION_RE_END, "");
    if (!body) continue;

    // `<level> | <fact>` — the level is optional and defaults to project.
    let level: ProposedMemory["level"] = "project";
    let fact = body;
    const bar = body.indexOf("|");
    if (bar !== -1) {
      const head = body.slice(0, bar).trim().toLowerCase();
      // Anything other than an explicit "global" contains the blast radius:
      // a wrong global fact pollutes every future project, a wrong project
      // fact stays put. And a head that isn't word-shaped isn't a level at
      // all — keep the whole sentence rather than eating half of it.
      if (LEVEL_HEAD_RE.test(head)) {
        if (head === "global") level = "global";
        fact = body.slice(bar + 1).trim();
      }
    }

    if (!fact) continue;
    if (fact.length > MAX_FACT_CHARS) continue;
    if (isNullContent(fact)) continue;
    out.push({ fact, level });
  }
  return out;
}

/**
 * Remove the sentinel lines from narration. Memory bookkeeping is silent — the
 * designer sees the summary and the Deviations section, never the plumbing.
 * Drops the whole line so no blank gap is left behind.
 *
 * Deliberately strips every line `matchSentinelLine` recognises, including ones
 * `extractProposedMemories` then rejects (null content, over-long, past the
 * per-turn cap): a rejected proposal is still plumbing, and must not surface.
 */
export function stripMemoryLines(text: string): string {
  if (!text.includes(SENTINEL_GLYPH)) return text;
  const out: string[] = [];
  for (const { line, term } of splitLines(text)) {
    if (matchSentinelLine(line) !== null) {
      // A sentinel line at the very end has no terminator of its own; drop the
      // one that preceded it so no dangling break is left behind.
      if (!term && out.length) out.pop();
      continue;
    }
    out.push(line);
    if (term) out.push(term);
  }
  return out.join("");
}
