// @vitest-environment node
//
// Regressions in the memory-proposal contract that a review caught:
//
//  1. A sentinel inside a fenced code block was extracted as a real proposal.
//     The designer asks "how does memory work?", the agent SHOWS the line, and a
//     permanent standing instruction gets written off an explanation — with the
//     agent's own "I recorded nothing" sentence still on screen.
//  2. The per-turn cap was per CALL, and the caller accumulates across many
//     narration messages, so one turn could write 3 × messages rows.
//  3. The line matcher was a hand-copied duplicate of MEMORY_SENTINEL, so
//     editing the constant left the parser matching the old shape — silently, in
//     the direction that leaks plumbing into the chat pane.
import { describe, it, expect } from "vitest";
import {
  MEMORY_SENTINEL,
  MAX_MEMORIES_PER_TURN,
  extractProposedMemories,
  stripMemoryLines,
  capProposalsPerTurn,
  isMemoryLine,
  type ProposedMemory,
} from "../../server/memoryContract";

describe("fenced code blocks are shown, not said", () => {
  const explain =
    "You asked how memory works. I record a line like this:\n\n" +
    "```\n" +
    `${MEMORY_SENTINEL} global | use sentence case for all headings\n` +
    "```\n\n" +
    "I have not recorded anything this turn.";

  it("does not extract a sentinel inside a fence", () => {
    expect(extractProposedMemories(explain)).toEqual([]);
  });

  it("does not gut the fenced block either — that is the answer to the question", () => {
    // Stripping the contents while leaving "I recorded nothing" intact is the
    // worst of both: the explanation is destroyed AND (before the fix) the fact
    // was written anyway.
    const out = stripMemoryLines(explain);
    expect(out).toContain("use sentence case for all headings");
    expect(out).toContain("I have not recorded anything this turn.");
    expect(out).toBe(explain);
  });

  it("handles tilde fences and info strings", () => {
    const t = `Example:\n~~~text\n${MEMORY_SENTINEL} global | tilde fenced\n~~~\ndone`;
    expect(extractProposedMemories(t)).toEqual([]);
    const md = `Example:\n\`\`\`markdown\n${MEMORY_SENTINEL} global | info string fenced\n\`\`\`\ndone`;
    expect(extractProposedMemories(md)).toEqual([]);
  });

  it("still extracts a real proposal that appears AFTER a closed fence", () => {
    // The common shape: a code sample, then the reply's real bookkeeping line.
    const text =
      "Here's the change:\n\n```tsx\nconst x = 1;\n```\n\n" +
      `${MEMORY_SENTINEL} project | filter chips go in the toolbar`;
    expect(extractProposedMemories(text)).toEqual([
      { fact: "filter chips go in the toolbar", level: "project" },
    ]);
  });

  it("still extracts a real proposal BETWEEN two closed fences", () => {
    const text =
      "```\nfirst\n```\n" +
      `${MEMORY_SENTINEL} project | between the fences\n` +
      "```\nsecond\n```";
    expect(extractProposedMemories(text)).toEqual([
      { fact: "between the fences", level: "project" },
    ]);
  });

  it("treats an UNCLOSED fence as no fence, so the line is still stripped", () => {
    // Malformed markdown. Of the two readings, "not a fence" is the safe one: a
    // plumbing line must never reach the chat pane because the agent forgot a
    // closing fence.
    const text = `Explaining:\n\`\`\`\n${MEMORY_SENTINEL} project | unclosed fence fact`;
    expect(stripMemoryLines(text)).not.toContain("unclosed fence fact");
  });

  it("the fence exemption is the SAME in extract and strip", () => {
    // The file's invariant #1: a disagreement is always a bug. Match-but-no-strip
    // leaks; strip-but-no-match silently drops the memory.
    for (const text of [
      `\`\`\`\n${MEMORY_SENTINEL} project | inside\n\`\`\``,
      `${MEMORY_SENTINEL} project | outside`,
      `\`\`\`\na\n\`\`\`\n${MEMORY_SENTINEL} project | after`,
    ]) {
      const extracted = extractProposedMemories(text).length > 0;
      const stripped = stripMemoryLines(text) !== text;
      expect(stripped).toBe(extracted);
    }
  });
});

describe("capProposalsPerTurn", () => {
  const p = (fact: string): ProposedMemory => ({ fact, level: "project" });

  it("passes through anything within the cap", () => {
    const few = [p("a"), p("b")];
    expect(capProposalsPerTurn(few)).toEqual(few);
  });

  it("keeps only the first MAX_MEMORIES_PER_TURN", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(p);
    const out = capProposalsPerTurn(many);
    expect(out.length).toBe(MAX_MEMORIES_PER_TURN);
    expect(out).toEqual(many.slice(0, MAX_MEMORIES_PER_TURN));
  });

  it("bounds an accumulator built from several messages, not just one", () => {
    // This is exactly the shape chat.ts produces: three narration messages, each
    // individually within the per-message cap, summing well past the turn cap.
    const messages = [
      `${MEMORY_SENTINEL} project | fact a one\n${MEMORY_SENTINEL} project | fact a two\n${MEMORY_SENTINEL} project | fact a three`,
      `${MEMORY_SENTINEL} project | fact b one\n${MEMORY_SENTINEL} project | fact b two\n${MEMORY_SENTINEL} project | fact b three`,
      `${MEMORY_SENTINEL} project | fact c one`,
    ];
    const accumulated: ProposedMemory[] = [];
    for (const m of messages) accumulated.push(...extractProposedMemories(m));
    expect(accumulated.length).toBe(7); // the per-message cap alone lets 7 through
    expect(capProposalsPerTurn(accumulated).length).toBe(MAX_MEMORIES_PER_TURN);
  });
});

describe("the matcher is derived from MEMORY_SENTINEL, not hand-copied", () => {
  // Before this, MEMORY_SENTINEL, the glyph early-out and the line regex were
  // three independent copies of the same string. Editing the constant kept every
  // test green while extraction and stripping both stopped matching — the
  // sentinel then renders to the designer and nothing fails.
  it("recognises a line built from the exported constant", () => {
    expect(isMemoryLine(`${MEMORY_SENTINEL} project | x`)).toBe(true);
    expect(extractProposedMemories(`${MEMORY_SENTINEL} project | derived from the constant`)).toEqual(
      [{ fact: "derived from the constant", level: "project" }],
    );
  });

  it("strips a line built from the exported constant", () => {
    const text = `A\n${MEMORY_SENTINEL} project | derived from the constant\nB`;
    expect(stripMemoryLines(text)).toBe("A\nB");
  });

  it("does not recognise a near-miss glyph", () => {
    expect(isMemoryLine("◈ remember: project | wrong glyph")).toBe(false);
  });
});
