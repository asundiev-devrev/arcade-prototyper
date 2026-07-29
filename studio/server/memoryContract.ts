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
 *
 * Both invariants are enforced by construction below: the glyph early-out and
 * the line matcher are DERIVED from `MEMORY_SENTINEL`, so changing the sentinel
 * cannot leave a stale duplicate behind. A hand-copied regex fails open — the
 * prompt asks for one shape, the parser matches another, and the plumbing line
 * silently starts appearing in the designer's chat pane.
 */
export const MEMORY_SENTINEL = "⟐ remember:";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The sentinel split into its glyph and its keyword, straight off the constant.
 * `⟐ remember:` → `⟐` + `remember:`.
 */
const [SENTINEL_GLYPH, SENTINEL_WORD] = (() => {
  const m = /^(\S+)[ \t]*(.*)$/.exec(MEMORY_SENTINEL);
  return [m?.[1] ?? MEMORY_SENTINEL, m?.[2] ?? ""];
})();

export interface ProposedMemory {
  fact: string;
  level: "global" | "project";
}

/** One fact should be one sentence. Longer means the agent is pasting context. */
const MAX_FACT_CHARS = 200;
/**
 * More than a few per turn means it is narrating, not distilling.
 *
 * Exported because this function only sees ONE message, while a turn is many
 * messages: the caller accumulates across all of them and has to apply the same
 * cap to the accumulator, or a chatty turn writes 3 × (number of messages) rows
 * and floods the store. See `capProposalsPerTurn`.
 */
export const MAX_MEMORIES_PER_TURN = 3;
const MAX_PER_TURN = MAX_MEMORIES_PER_TURN;
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
 *
 * Built from MEMORY_SENTINEL, never hand-copied — see the header note.
 */
const SENTINEL_LINE_RE = new RegExp(
  `^[ \\t>*_\`~+-]*${escapeRe(SENTINEL_GLYPH)}[ \\t]*${escapeRe(SENTINEL_WORD)}(.*)$`,
  "i",
);

/**
 * A fenced-code opener/closer: ``` or ~~~, optionally indented, optionally with
 * an info string. Inside a fence the agent is SHOWING text, not saying it.
 */
const FENCE_RE = /^[ \t]*(?:`{3,}|~{3,})/;

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

/**
 * Is this single line a memory-proposal line? The same matcher extract/strip
 * use, so no caller can disagree with them about what a sentinel is.
 *
 * Exists for the stream parser, which classifies lines BEFORE the memory seam
 * runs: a sentinel that also carries a journey marker must not be promoted into
 * a journey event, because journeys bypass the seam and render verbatim.
 */
export function isMemoryLine(line: string): boolean {
  return matchSentinelLine(line) !== null;
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

/**
 * The ONE scanner both public functions walk. Adds fenced-code state to each
 * line, because a sentinel inside a fence is the agent SHOWING the line, not
 * saying it — most often when the designer asked how memory works and the reply
 * quotes the format. Line-based matching cannot tell those apart on its own, and
 * getting it wrong writes a permanent standing instruction off an explanation,
 * with no cue that anything was recorded.
 *
 * Fence lines are content: a fenced block is left completely alone — not
 * extracted (nothing is recorded) and not stripped (the explanation the designer
 * asked for stays readable).
 *
 * Only CLOSED fences count. An unpaired trailing ``` is malformed markdown, and
 * of the two ways to read it, "not a fence" is the safe one: the sentinel is
 * still stripped, so a plumbing line can never reach the chat pane because the
 * agent forgot a closing fence.
 */
function scanLines(text: string): { line: string; term: string; inFence: boolean }[] {
  const parts = splitLines(text);
  const delims: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (FENCE_RE.test(parts[i].line)) delims.push(i);
  }
  const fenced = new Array<boolean>(parts.length).fill(false);
  for (let d = 0; d + 1 < delims.length; d += 2) {
    for (let i = delims[d]; i <= delims[d + 1]; i += 1) fenced[i] = true;
  }
  return parts.map((p, i) => ({ ...p, inFence: fenced[i] }));
}

export function extractProposedMemories(text: string): ProposedMemory[] {
  if (!text.includes(SENTINEL_GLYPH)) return [];
  const out: ProposedMemory[] = [];
  for (const { line, inFence } of scanLines(text)) {
    if (out.length >= MAX_PER_TURN) break;
    if (inFence) continue;
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
 * Enforce the per-TURN cap on an accumulator built from several messages.
 *
 * `extractProposedMemories` caps one message, which is the wrong unit: a turn
 * emits many narration messages (plus the phantom-edit retry's), each capped
 * independently, so three messages of three sentinels each get nine rows past a
 * limit that reads like it bounds the turn. Keeps the FIRST few — a reply's
 * earlier proposals are the ones the agent led with.
 */
export function capProposalsPerTurn(proposals: ProposedMemory[]): ProposedMemory[] {
  return proposals.length <= MAX_MEMORIES_PER_TURN
    ? proposals
    : proposals.slice(0, MAX_MEMORIES_PER_TURN);
}

/**
 * Remove the sentinel lines from narration. Memory bookkeeping is silent — the
 * designer sees the summary and the Deviations section, never the plumbing.
 * Drops the whole line so no blank gap is left behind.
 *
 * Deliberately strips every line `matchSentinelLine` recognises, including ones
 * `extractProposedMemories` then rejects (null content, over-long, past the
 * per-turn cap): a rejected proposal is still plumbing, and must not surface.
 *
 * The ONE exception is a fenced-code block, and it is the same exception
 * extraction makes: inside a fence the line is the agent quoting the format,
 * usually because the designer asked how memory works. Gutting that block would
 * silently delete the answer to the question.
 */
export function stripMemoryLines(text: string): string {
  if (!text.includes(SENTINEL_GLYPH)) return text;
  const out: string[] = [];
  for (const { line, term, inFence } of scanLines(text)) {
    if (!inFence && matchSentinelLine(line) !== null) {
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
