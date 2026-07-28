// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  MEMORY_SENTINEL,
  extractProposedMemories,
  stripMemoryLines,
} from "../../server/memoryContract";

describe("extractProposedMemories", () => {
  it("reads a global proposal", () => {
    const out = extractProposedMemories(
      `Built the nav.\n${MEMORY_SENTINEL} global | Active nav rows use neutral gray\n\n### Deviations\n\nNone.`,
    );
    expect(out).toEqual([{ fact: "Active nav rows use neutral gray", level: "global" }]);
  });

  it("reads a project proposal", () => {
    const out = extractProposedMemories(`${MEMORY_SENTINEL} project | Filter chips go in the toolbar`);
    expect(out).toEqual([{ fact: "Filter chips go in the toolbar", level: "project" }]);
  });

  it("defaults an unrecognised level to project (the safer scope)", () => {
    // A wrong global memory pollutes every future project; a wrong project one
    // is contained. When the agent is unclear, contain it.
    const out = extractProposedMemories(`${MEMORY_SENTINEL} everywhere | Something`);
    expect(out).toEqual([{ fact: "Something", level: "project" }]);
  });

  it("tolerates a missing level separator", () => {
    const out = extractProposedMemories(`${MEMORY_SENTINEL} Use sentence case for headings`);
    expect(out).toEqual([{ fact: "Use sentence case for headings", level: "project" }]);
  });

  it("returns nothing when there is no sentinel", () => {
    expect(extractProposedMemories("I will remember to use teal accents.")).toEqual([]);
  });

  it("ignores a sentinel with an empty fact", () => {
    expect(extractProposedMemories(`${MEMORY_SENTINEL} global |    `)).toEqual([]);
  });

  it("caps at 3 proposals per turn", () => {
    const many = Array.from({ length: 8 }, (_, i) => `${MEMORY_SENTINEL} project | fact ${i}`).join("\n");
    expect(extractProposedMemories(many)).toHaveLength(3);
  });

  it("rejects an absurdly long fact rather than storing a paragraph", () => {
    const out = extractProposedMemories(`${MEMORY_SENTINEL} project | ${"x".repeat(400)}`);
    expect(out).toEqual([]);
  });

  it("trims trailing punctuation noise but keeps sentence text", () => {
    const out = extractProposedMemories(`${MEMORY_SENTINEL} project | Keep empty states terse.  `);
    expect(out[0].fact).toBe("Keep empty states terse.");
  });
});

// --- Regression: markdown decoration must not decide whether memory works ---
// The agent writes markdown, so the sentinel arrives wrapped in it. Requiring
// the line to start with the sentinel killed capture AND leaked the raw line to
// the designer at the same time.
describe("decorated sentinel lines", () => {
  const decorated: [string, string][] = [
    ["backticked", "`⟐ remember: global | Active nav rows use neutral gray`"],
    ["bulleted", "- ⟐ remember: global | Active nav rows use neutral gray"],
    ["bolded", "**⟐ remember:** global | Active nav rows use neutral gray"],
    ["blockquoted", "> ⟐ remember: global | Active nav rows use neutral gray"],
    ["indented bullet", "  * ⟐ remember: global | Active nav rows use neutral gray"],
  ];

  for (const [label, line] of decorated) {
    it(`captures a ${label} proposal`, () => {
      expect(extractProposedMemories(`Built the nav.\n\n${line}\n\n### Deviations\n\nNone.`)).toEqual([
        { fact: "Active nav rows use neutral gray", level: "global" },
      ]);
    });

    it(`strips a ${label} proposal so the designer never sees it`, () => {
      const out = stripMemoryLines(`Built the nav.\n\n${line}\n\n### Deviations\n\nNone.`);
      expect(out).not.toContain(MEMORY_SENTINEL);
      expect(out).not.toContain("Active nav rows use neutral gray");
      expect(out).toContain("Built the nav.");
      expect(out).toContain("### Deviations");
    });
  }

  it("round-trips a FILLED-IN copy of the line the CLAUDE.md template teaches (fails closed on drift)", () => {
    // The template shows the line inside backticks with indentation. If the
    // parser ever stops accepting that exact shape, capture dies silently — a
    // sentinel-substring check would still pass, so assert the parse itself.
    // The placeholders are filled in on purpose: the template's own example,
    // verbatim, must NOT parse (see "template placeholders" below).
    const tplLine = "   `⟐ remember: global | Active nav rows use neutral gray`";
    expect(extractProposedMemories(tplLine)).toEqual([
      { fact: "Active nav rows use neutral gray", level: "global" },
    ]);
    expect(stripMemoryLines(tplLine)).not.toContain(MEMORY_SENTINEL);
  });
});

// --- Regression: the template's own example must not become a real memory ---
// The response shape has to show the line's literal form, and an LLM echoing a
// format placeholder verbatim is ordinary behaviour. Before this guard the
// template example parsed as a real fact: `<global|project>` is not a
// word-shaped level head so nothing was stripped as a level, and the
// normalized body ("global project the preference one short sentence") matched
// no null-content rule. It became a permanent bullet in LEARNED.md, injected
// into every later turn, with no UI cue pointing at memory as the cause.
describe("template placeholders are never captured", () => {
  const echoes: [string, string][] = [
    ["the template line verbatim", "   `⟐ remember: <global|project> | <the preference, one short sentence>`"],
    ["undecorated", "⟐ remember: <global|project> | <the preference, one short sentence>"],
    ["level filled, fact still a placeholder", "⟐ remember: global | <the preference, one short sentence>"],
    ["fact filled, level still a placeholder", "⟐ remember: <global|project> | Active nav rows use neutral gray"],
    ["angle placeholder mid-sentence", "⟐ remember: project | Use <the designer's> preferred casing"],
    ["bare placeholder, no level bar", "⟐ remember: <the preference>"],
  ];

  for (const [label, line] of echoes) {
    it(`records nothing when the agent echoes ${label}`, () => {
      expect(extractProposedMemories(line)).toEqual([]);
    });

    it(`still strips ${label} so the plumbing never reaches the designer`, () => {
      // Rejected proposals are still plumbing: strip must be broader than
      // extract, or the leak the sentinel exists to avoid comes back.
      expect(stripMemoryLines(`Built the nav.\n${line}\n`)).not.toContain(MEMORY_SENTINEL);
    });
  }

  it("does not reject a real fact that merely contains a comparison operator", () => {
    // Guard the guard: only bracket PAIRS are placeholders. A lone `<` or `>`
    // must not silently cost the designer a memory.
    const out = extractProposedMemories(`${MEMORY_SENTINEL} project | Keep dense tables under 8 rows > that use a list`);
    expect(out).toHaveLength(1);
  });
});

// --- Regression: extract and strip must agree on what a "line" is ---
describe("exotic line terminators", () => {
  const LS = " ";
  const PS = " ";

  it("does not treat U+2028-separated mid-paragraph text as a capturable line unless strip agrees", () => {
    const text = `Built the nav.${LS}${MEMORY_SENTINEL} global | Sneaky fact${LS}Done.`;
    const extracted = extractProposedMemories(text);
    const stripped = stripMemoryLines(text);
    // Whatever the policy, the two must never disagree: anything captured must
    // also be hidden, or the designer sees the plumbing.
    for (const m of extracted) expect(stripped).not.toContain(m.fact);
    expect(stripped).not.toContain(MEMORY_SENTINEL);
  });

  it("strips a U+2029-separated sentinel line", () => {
    const text = `Built the nav.${PS}${MEMORY_SENTINEL} project | Some fact${PS}Done.`;
    expect(stripMemoryLines(text)).not.toContain(MEMORY_SENTINEL);
  });

  it("handles CRLF narration", () => {
    const text = `A\r\n${MEMORY_SENTINEL} project | Keep chips in the toolbar\r\nB`;
    expect(extractProposedMemories(text)).toEqual([
      { fact: "Keep chips in the toolbar", level: "project" },
    ]);
    expect(stripMemoryLines(text)).toBe("A\r\nB");
  });
});

// --- Regression: a pipe inside the fact is not a level separator ---
describe("level parsing", () => {
  it("keeps the whole fact when the text before the pipe is not a level", () => {
    expect(extractProposedMemories(`${MEMORY_SENTINEL} Dialog footers read "Cancel | Save"`)).toEqual([
      { fact: 'Dialog footers read "Cancel | Save"', level: "project" },
    ]);
  });

  it("keeps later pipes inside the fact when a real level is present", () => {
    expect(
      extractProposedMemories(`${MEMORY_SENTINEL} project | Columns: Name | Status | Owner`),
    ).toEqual([{ fact: "Columns: Name | Status | Owner", level: "project" }]);
  });

  it("keeps the whole fact for a multi-word head that only looks like a level", () => {
    expect(
      extractProposedMemories(`${MEMORY_SENTINEL} Table headers | rows use sentence case`),
    ).toEqual([{ fact: "Table headers | rows use sentence case", level: "project" }]);
  });

  it("only 'global' widens the scope", () => {
    expect(extractProposedMemories(`${MEMORY_SENTINEL} GLOBAL | Taste fact`)).toEqual([
      { fact: "Taste fact", level: "global" },
    ]);
    expect(extractProposedMemories(`${MEMORY_SENTINEL} everywhere | Taste fact`)).toEqual([
      { fact: "Taste fact", level: "project" },
    ]);
  });
});

// --- Regression: one case policy, applied in both functions ---
describe("sentinel case policy", () => {
  it("accepts a capitalised sentinel (an LLM capitalising a sentence is ordinary)", () => {
    expect(extractProposedMemories("Built it.\n⟐ Remember: global | Case fact")).toEqual([
      { fact: "Case fact", level: "global" },
    ]);
  });

  it("strips a capitalised sentinel too — capture and hiding never disagree", () => {
    const out = stripMemoryLines("Built it.\n⟐ Remember: global | Case fact");
    expect(out).not.toContain("Remember:");
    expect(out).not.toContain("Case fact");
    expect(out).toBe("Built it.");
  });

  it("behaves the same whether or not another lowercase sentinel is present", () => {
    const alone = extractProposedMemories("⟐ Remember: global | Case fact");
    const withSibling = extractProposedMemories(
      `${MEMORY_SENTINEL} project | real fact\n⟐ Remember: global | Case fact`,
    );
    expect(alone).toEqual([{ fact: "Case fact", level: "global" }]);
    expect(withSibling).toEqual([
      { fact: "real fact", level: "project" },
      { fact: "Case fact", level: "global" },
    ]);
  });
});

// --- Regression: a mandatory response slot invites null answers ---
// The memory line sits next to `### Deviations`, whose convention is to answer
// "None." — so slot-filling is the predictable failure. Each of these would
// otherwise become a permanent standing instruction in every future turn.
describe("null-content rejection", () => {
  const nulls = [
    "None.",
    "none",
    "N/A",
    "n/a",
    "NA",
    "nil",
    "Nothing",
    "nothing durable this turn",
    "None this turn",
    "No memories this turn",
    "TBD",
    "-",
    "x",
  ];

  for (const body of nulls) {
    it(`rejects ${JSON.stringify(body)} as a fact`, () => {
      expect(extractProposedMemories(`${MEMORY_SENTINEL} ${body}`)).toEqual([]);
      expect(extractProposedMemories(`${MEMORY_SENTINEL} global | ${body}`)).toEqual([]);
    });
  }

  it("rejects a bare level with no fact after it", () => {
    expect(extractProposedMemories(`${MEMORY_SENTINEL} global`)).toEqual([]);
    expect(extractProposedMemories(`${MEMORY_SENTINEL} project`)).toEqual([]);
  });

  it("still hides a rejected proposal from the designer", () => {
    const text = `Built the nav.\n${MEMORY_SENTINEL} global | None.\n\n### Deviations\n\nNone.`;
    expect(extractProposedMemories(text)).toEqual([]);
    const out = stripMemoryLines(text);
    expect(out).not.toContain(MEMORY_SENTINEL);
    expect(out).toContain("### Deviations");
  });

  it("keeps a real fact that merely mentions one of the null words", () => {
    expect(extractProposedMemories(`${MEMORY_SENTINEL} project | Empty states say "Nothing here yet"`)).toEqual(
      [{ fact: 'Empty states say "Nothing here yet"', level: "project" }],
    );
  });
});

describe("stripMemoryLines", () => {
  it("removes the sentinel line so the designer never sees it", () => {
    const text = `Built the nav.\n${MEMORY_SENTINEL} global | Neutral gray for nav\n\n### Deviations\n\nNone.`;
    const out = stripMemoryLines(text);
    expect(out).not.toContain(MEMORY_SENTINEL);
    expect(out).not.toContain("Neutral gray for nav");
    expect(out).toContain("Built the nav.");
    expect(out).toContain("### Deviations");
  });

  it("leaves text without a sentinel untouched", () => {
    expect(stripMemoryLines("Built the nav.")).toBe("Built the nav.");
  });

  it("does not leave a blank-line hole where the line was", () => {
    const out = stripMemoryLines(`A\n${MEMORY_SENTINEL} project | x\nB`);
    expect(out).toBe("A\nB");
  });
});
