// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planFigmaTurn, type FigmaTurnInputs } from "../../../server/figma/turnRouting";
import type { FrameSource } from "../../../server/figma/provenance";
import { shouldGenerateFromFigma } from "../../../server/figma/generationIntent";
import {
  detectInteractionIntent,
  extractFigmaUrls,
} from "../../../src/lib/figmaUrl";
// parseFigmaUrl from the zero-import LEAF, not figmaCli: these tests assert the
// brain is loadable in a host with no CLI binary, so importing the figmanage
// driver here would make the claim untrue in the file that makes it.
import { parseFigmaUrl } from "../../../server/figma/figmaNodeUrl";
import { SCOPED_EDIT_MARKER } from "../../../src/lib/scopedEdit";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const corpus = require("../../fixtures/designer-prompts.json") as {
  prompts: Array<{ i: number; isCorrection: boolean; text: string }>;
};
const P = (i: number) => corpus.prompts[i].text;

const U1 = "https://www.figma.com/design/abc/Foo?node-id=1-2";
const U2 = "https://www.figma.com/design/abc/Foo?node-id=3-4";

/**
 * Derive the routing inputs the SAME way the middleware does, from the prompt
 * alone. Hand-setting `wantsGeneration` would let a test pass while the real
 * caller disagreed — the failure mode this whole file exists to prevent.
 */
function inputsFor(prompt: string): FigmaTurnInputs & { nodeIds: string[] } {
  const urls = extractFigmaUrls(prompt);
  return {
    hasFigmaNode: urls.length > 0,
    wantsGeneration: urls.length > 0 ? shouldGenerateFromFigma(prompt) : false,
    hasInteractionIntent: detectInteractionIntent(prompt),
    figmaUrlCount: urls.length,
    prompt,
    nodeIds: urls
      .map((u) => parseFigmaUrl(u)?.nodeId)
      .filter((n): n is string => Boolean(n)),
  };
}

/** The verified live-project provenance world: node 5678:118877 really does live
 *  in frame 01-figma-5678-118876/index.tsx (attribute-exact, line 11). */
const LIVE_FRAMES: FrameSource[] = [
  { slug: "00-computer-reference", source: "export default function Ref() { return <div/>; }" },
  {
    slug: "01-figma-5678-118876",
    source:
      "export default function FigmaImport() {\n" +
      '  <div data-figma-id="5678:118877" style={{position: "absolute"}}>\n' +
      '    <div data-figma-id="I5678:118877;5346:75923"/>\n' +
      "  </div>\n}",
  },
  { slug: "02-figma-5678-118907", source: '<div data-figma-id="5678:118908"/>' },
];

function reader(frames: FrameSource[] = LIVE_FRAMES) {
  return vi.fn(async () => frames);
}

describe("planFigmaTurn — the prompts this design FIXES", () => {
  // Corpus #1, the motivating correction: "You haven't implemented this
  // background blur properly: <url> try again". Today it routes to the
  // deterministic importer, which has no LLM, so it stamps a NEW frame and the
  // complaint is discarded. The pasted node already lives in
  // 01-figma-5678-118876, so provenance names the frame exactly — catching a
  // correction WITHOUT detecting corrections (which is banned; a correction is a
  // speech act, see turnRouting.ts case 4).
  it("#1 becomes an EDIT of the frame that already contains the node", async () => {
    const plan = await planFigmaTurn(inputsFor(P(1)), { readFrames: reader() });
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("provenance");
    expect(plan.targetFrame).toBe("01-figma-5678-118876");
  });

  // Corpus #30 literally contains "DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!"
  // and was routed to the importer, which stamped a separate frame. The
  // designer's very next turn (#31) is them explaining the failure back to us.
  it("#30 leaves the importer and carries the single-frame constraint", async () => {
    const plan = await planFigmaTurn(inputsFor(P(30)), { readFrames: reader() });
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("constraints");
    expect(plan.constraints).toEqual(["single-frame"]);
  });

  // #2 already reached the generator today (via interaction intent) but the
  // constraint was never derived, so nothing stopped the generator splitting the
  // frame — the template even encourages it (CLAUDE.md.tpl line 554 lists
  // "pressing Save goes to the confirmation" as a <FrameLink> signal, which is
  // verbatim this prompt's shape). Same branch, now carrying the constraint.
  it("#2 keeps its existing route but now carries the constraint", async () => {
    const plan = await planFigmaTurn(inputsFor(P(2)), { readFrames: reader() });
    expect(plan.kind).not.toBe("kit-emit");
    expect(plan.constraints).toEqual(["single-frame"]);
  });
});

describe("planFigmaTurn — the prompts this design does NOT fix (honest record)", () => {
  // #25 and #32 carry real instructions ("There must be three buttons on the
  // right hand side", "When a new tab is created, a user must see this page"),
  // reference nodes no rendered frame contains, and state no constraint — so
  // they still route to the importer and their prose is still discarded.
  //
  // This is asserted rather than hidden. Two deterministic rescues were measured
  // and rejected during implementation: a prose-length gate (long faithful-copy
  // prose measures residue 141, EXACTLY #25's and #32's — no threshold separates
  // them) and a requirement-modal detector (must/should/needs-to: 0 false
  // positives on the committed must-miss lists, then 19 of 19 on fidelity hedges
  // like "it should look exactly like this"). Fixing these needs a real resolver.
  // See the design spec §0 and §9 item 1.
  it("#25 and #32 still reach the deterministic importer", async () => {
    for (const i of [25, 32]) {
      const plan = await planFigmaTurn(inputsFor(P(i)), { readFrames: reader() });
      expect(plan.kind, `#${i}`).toBe("kit-emit");
      expect(plan.decidedBy, `#${i}`).toBe("default");
    }
  });
});

describe("planFigmaTurn — the fast path must not move", () => {
  it("the bare corpus imports stay deterministic", async () => {
    for (const i of [0, 37, 45, 53]) {
      const plan = await planFigmaTurn(inputsFor(P(i)), { readFrames: reader() });
      expect(plan.kind, `#${i}`).toBe("kit-emit");
      expect(plan.decidedBy, `#${i}`).toBe("default");
      // The importer cannot honour a constraint — that IS the bug — so the plan
      // must never hand it one it will silently drop.
      expect(plan.constraints, `#${i}`).toEqual([]);
    }
  });

  it("the canonical bare-import phrasings stay deterministic", async () => {
    const bare = [
      `Implement this precisely: ${U1}`,
      `import this ${U1}`,
      `bring this in ${U1}`,
      U1,
      `grab this design ${U1}`,
      `copy this exactly ${U1}`,
      `implement both screens precisely ${U1}`,
      `pixel-perfect build of this frame ${U1}`,
    ];
    for (const p of bare) {
      const plan = await planFigmaTurn(inputsFor(p), { readFrames: reader() });
      expect(plan.kind, p).toBe("kit-emit");
    }
  });

  // THE REGRESSION GUARD FOR THE WHOLE DESIGN. Every faithful-copy string the
  // committed must-miss lists protect must still reach the deterministic importer
  // — that fidelity guarantee is what the dominant Figma-import lane is built on.
  // It is also the exact regression the CUT prose gate would have caused: measured,
  // it flipped 20 of these 32 onto the LLM, which is why that layer was deleted.
  //
  // The strings are READ OUT OF `__tests__/lib/figmaUrl.test.ts` rather than
  // copied. A copy silently stops protecting anything the moment someone adds a
  // 33rd string over there — this file would keep passing while the new string
  // went unguarded. Parsing the sibling test file is unusual, so it is deliberate:
  // the list has ONE home, and the count is asserted so a parser that quietly
  // matches nothing fails loudly instead of vacuously passing.
  it("all 32 committed must-stay-deterministic strings stay on the importer (one named exception)", async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../lib/figmaUrl.test.ts"),
      "utf8",
    );
    const all: string[] = [];
    for (const listName of ["copies", "negatedOrDescriptive", "provenance", "bulleted"]) {
      const block = new RegExp(`const ${listName}\\s*=\\s*\\[([\\s\\S]*?)\\n {4}\\];`).exec(src);
      expect(block, `must-miss list "${listName}" not found in figmaUrl.test.ts`).toBeTruthy();
      // One quoted literal per line, single/double/backtick, escapes preserved.
      for (const m of block![1].matchAll(
        /^\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*,\s*$/gm,
      )) {
        // eslint-disable-next-line no-eval
        all.push(eval(m[1]) as string);
      }
    }
    // Pins the extraction itself. If either number moves, the sibling list moved,
    // and whoever moved it must look at the routing consequences on purpose. 32
    // strings, of which one is "" (a must-miss for the detector; nothing to route
    // here, since the router needs a URL to do anything at all).
    expect(all.length).toBe(32);
    const mustMiss = all.filter(Boolean);
    expect(mustMiss.length).toBe(31);

    // ACCEPTED, on purpose: this string IS a single-frame constraint, so L3 is
    // right to fire and the divert is right to happen. It lives in a must-miss
    // list for a DIFFERENT detector (detectInteractionIntent). Spec §2.6. Named
    // explicitly so it cannot quietly become two.
    const ACCEPTED_FLIP = "keep everything on a single frame";
    expect(mustMiss, "the accepted flip must be one of the read-in strings").toContain(
      ACCEPTED_FLIP,
    );

    const flipped: string[] = [];
    for (const s of mustMiss) {
      const plan = await planFigmaTurn(inputsFor(`${s} ${U1}`), { readFrames: reader() });
      if (plan.kind !== "kit-emit") flipped.push(s);
    }
    expect(flipped).toEqual([ACCEPTED_FLIP]);

    // …and the one flip is a CONSTRAINT divert, not some other accident.
    const flip = await planFigmaTurn(inputsFor(`${ACCEPTED_FLIP} ${U1}`), {
      readFrames: reader(),
    });
    expect(flip.kind).toBe("claude");
    expect(flip.decidedBy).toBe("constraints");
  });

  // Same 32 strings, against the OTHER must-miss set's owner. The build-intent
  // strings in generationIntent.test.ts must all still REACH the generator, which
  // is the mirror-image guard — pinned in its own block further down.
  it("also holds with NO provenance reader (the plain Claude-Code host)", async () => {
    for (const s of [
      "implement this screen precisely",
      "the spinner animates in the prototype but keep it static for now",
      "This is the screen after clicking Continue. Implement it precisely.",
    ]) {
      const plan = await planFigmaTurn(inputsFor(`${s} ${U1}`));
      expect(plan.kind, s).toBe("kit-emit");
    }
  });
});

describe("planFigmaTurn — today's routing is preserved above the new layers", () => {
  // ORDERING BLOCKER (adversarial review, verified by running the real modules).
  // Build intent is the ONLY thing keeping short edit instructions off the
  // importer today. If any new layer is consulted BEFORE `wantsGeneration`, these
  // go BACKWARDS to the LLM-less importer — re-creating the exact instruction-loss
  // bug this design exists to fix, on a class of prompt that works correctly
  // today. Every string here is from the committed generationIntent.test.ts
  // must-generate sets.
  it("every committed build-intent string still reaches the generator", async () => {
    const mustGenerate = [
      "the input must be functional",
      "make the search work",
      "remove the search bar",
      "delete the top nav",
      "swap the logo for ours",
      "replace the avatars with initials",
      "rename the tabs",
      "make the sidebar dark",
      "replace the header with a banner",
      "recreate this exactly, remove the search bar",
      "implement precisely but make the sidebar dark",
      "use that composite as a base",
      "modify the ComputerScene composite",
      "start from the ComputerScene empty state",
      "apply this theme to the nav and canvas",
      "the purple theme must be applied to all of the UI",
      "clicking Connect opens this dialog",
    ];
    for (const s of mustGenerate) {
      const plan = await planFigmaTurn(inputsFor(`${s} ${U1}`), { readFrames: reader() });
      expect(plan.kind, s).not.toBe("kit-emit");
      expect(plan.decidedBy, s).toBe("legacy-intent");
    }
  });

  // The eject/compose-base path is only consulted inside runClaudeBranch, so a
  // turn routed to kit-emit can never eject — generationIntent.ts states that
  // invariant in a doc comment. Pin it at the routing layer too.
  it("a compose-base turn still reaches the generator so eject stays possible", async () => {
    for (const s of ["use the ComputerScene template", "modify the ComputerScene composite"]) {
      const plan = await planFigmaTurn(inputsFor(`${s} ${U1}`), { readFrames: reader() });
      expect(plan.kind, s).toBe("claude");
    }
  });

  // ORDERING BLOCKER 2. The wire branch (shipped 0.35.1) imports URL#2 as
  // Overlay.tsx and runs the scoped wiring pass. A new layer placed above it
  // would silently drop URL#2 and wire nothing — the designer gets one static
  // screen, which is the bug the wire branch was built to fix.
  it("interaction intent + 2 URLs still routes to wire", async () => {
    const wires = [
      `on click show this modal ${U1} ${U2}`,
      `implement this screen ${U1} AND wire a modal on click ${U2}`,
      `${U1} clicking opens ${U2}`,
      `on hover, show a tooltip ${U1} ${U2}`,
    ];
    for (const p of wires) {
      const plan = await planFigmaTurn(inputsFor(p), { readFrames: reader() });
      expect(plan.kind, p).toBe("wire");
      expect(plan.decidedBy, p).toBe("legacy-intent");
    }
  });

  // A REVIEWER CALLED THIS A DROPPED CONSTRAINT. It is not, and the difference
  // matters because the proposed "fix" was to stop carrying constraints on this
  // exit. Checked against the branch: `runFigmaWireBranch` imports URL#2 into the
  // SAME frame dir as a sibling `Overlay.tsx` (chat.ts:1722 `entryFileName`), so a
  // wire turn produces ONE frame; and `buildWirePrompt` already says "Do NOT create
  // a new frame. Do NOT move the overlay into its own frame." (chat.ts:1782). The
  // constraint is therefore satisfied by construction here — carrying it costs
  // nothing and is honest, and NO corpus prompt takes this exit with one anyway.
  it("a wire turn carries a constraint the branch already satisfies structurally", async () => {
    const prompt =
      "When I click Save, animate the transition to this screen: " +
      `${U1} and the overlay is ${U2} — don't separate these screens onto multiple frames.`;
    const plan = await planFigmaTurn(inputsFor(prompt), { readFrames: reader() });
    expect(plan.kind).toBe("wire");
    expect(plan.decidedBy).toBe("legacy-intent");
    expect(plan.constraints).toEqual(["single-frame"]);
  });

  it("a scoped element edit still wins, and pays for no I/O", async () => {
    const r = reader();
    const prompt =
      SCOPED_EDIT_MARKER +
      "\n\nTarget element: <Button> \"All Knowledge\"\n\n" +
      `Make it a filter that opens this popover ${U1} menu ${U2}`;
    const plan = await planFigmaTurn(inputsFor(prompt), { readFrames: r });
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("scoped-edit");
    expect(plan.constraints).toEqual([]);
    expect(r).not.toHaveBeenCalled();
  });
});

describe("planFigmaTurn — a prompt with NO Figma URL is completely unaffected", () => {
  // HARD CONSTRAINT 2, and this exact bug already SHIPPED. classifyFigmaTurn
  // returns "claude" for every prompt with no Figma URL, so a gate written as
  // `kind === "claude" && hasConstraint` also fires on ordinary prompts — and a
  // designer typing "New screen: an error state with a Try again button" was told
  // "Do NOT create a new frame directory". 54 of the 67 corpus prompts have no
  // Figma URL, so this is the majority path, not an edge case.
  it("routes to claude via no-node, with no constraints and no I/O", async () => {
    const r = reader();
    const plan = await planFigmaTurn(
      inputsFor("New screen: an error state with a Try again button"),
      { readFrames: r },
    );
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("no-node");
    expect(plan.constraints).toEqual([]);
    expect(plan.targetFrame).toBeUndefined();
    expect(r).not.toHaveBeenCalled();
  });

  // The ADVERSARIAL version: a no-URL prompt that WOULD trip the constraint
  // detector. The scope guard must be structural — constraints are never even
  // computed on this path — not a filter applied afterwards.
  it("does NOT derive a constraint from a no-URL prompt that states one", async () => {
    const r = reader();
    const plan = await planFigmaTurn(
      inputsFor("Add the confirmation step, keep everything on a single frame"),
      { readFrames: r },
    );
    expect(plan.decidedBy).toBe("no-node");
    expect(plan.constraints).toEqual([]);
    expect(r).not.toHaveBeenCalled();
  });

  // Every no-URL corpus prompt (54 of 67) must produce the same inert plan.
  it("all 54 no-URL corpus prompts route to no-node with no constraints", async () => {
    const noUrl = corpus.prompts.filter((p) => extractFigmaUrls(p.text).length === 0);
    expect(noUrl.length).toBeGreaterThanOrEqual(50);
    for (const p of noUrl) {
      const plan = await planFigmaTurn(inputsFor(p.text), { readFrames: reader() });
      expect(plan.kind, `#${p.i}`).toBe("claude");
      expect(plan.decidedBy, `#${p.i}`).toBe("no-node");
      expect(plan.constraints, `#${p.i}`).toEqual([]);
    }
  });
});

describe("planFigmaTurn — provenance edge cases at the routing layer", () => {
  it("does not name a frame when provenance is ambiguous, but still leaves the importer", async () => {
    const dup: FrameSource[] = [
      { slug: "01-a", source: '<div data-figma-id="5678:118877"/>' },
      { slug: "02-b", source: '<div data-figma-id="5678:118877"/>' },
    ];
    const plan = await planFigmaTurn(inputsFor(P(1)), { readFrames: reader(dup) });
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("provenance");
    expect(plan.targetFrame).toBeUndefined();
    expect(plan.frameCandidates).toEqual(["01-a", "02-b"]);
  });

  // FOUND BY THIS TEST FILE, and it changed the design. Corpus #0 is the verbatim
  // bare ask "Implement this precisely: <url>" — and that URL points at the ROOT
  // node of frame 01-figma-5678-118876, so provenance source 3 resolves it as
  // `origin`. Diverting on that would pull the canonical bare import off the
  // deterministic fast path (hard constraint 4) — a 16-26s no-model turn becoming
  // a generation turn — to fix nothing: measured across the 13 corpus Figma
  // prompts, `origin` is the SOLE escape for zero of them. So `origin` names the
  // frame but must not, alone, take a turn off the importer. Only `exact` and
  // `nested` — "the node is DRAWN INSIDE an existing frame" — divert.
  it("re-pasting a frame's OWN root url stays on the importer (origin does not divert)", async () => {
    const plan = await planFigmaTurn(inputsFor(P(0)), { readFrames: reader() });
    expect(plan.kind).toBe("kit-emit");
    expect(plan.decidedBy).toBe("default");
  });

  it("a nested-instance containment hit DOES divert", async () => {
    const nested: FrameSource[] = [
      { slug: "01-host", source: '<div data-figma-id="I5678:118877;5346:75923"/>' },
    ];
    const plan = await planFigmaTurn(inputsFor(P(1)), { readFrames: reader(nested) });
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("provenance");
    expect(plan.targetFrame).toBe("01-host");
  });

  // A CHILD-NODE HIT MEANS "EDIT THE PARENT", and that is a DECISION, not an
  // accident — stated here because a review flagged it as unspecified, correctly.
  //
  // Frame 01-figma-5678-118876 stamps 25 child ids, so pasting any of them is an
  // `exact` hit and diverts to an edit of frame 01. The competing reading is
  // "import this sub-component as its own frame", which is also a real designer
  // move. We choose EDIT because of what each error costs: a wrong edit is
  // visible, in a named frame, and one follow-up turn undoes it, whereas the
  // status quo — the bug this branch exists for — silently stamps a duplicate
  // frame and discards everything the designer typed, which is precisely how
  // corpus #30/#31 played out live (the designer's next turn is them explaining
  // the failure back to us).
  //
  // The designer also has an unambiguous escape from the wrong branch and none
  // from the right one: pasting the sub-component's URL in a NEW project imports
  // it cleanly, because provenance is per-project by construction.
  it("pasting a CHILD of an already-imported frame is an edit of that frame", async () => {
    const child = "https://www.figma.com/design/abc/Foo?node-id=5678-118885";
    const withChild: FrameSource[] = [
      {
        slug: "01-figma-5678-118876",
        // 5678:118885 is a real child id in the live frame, and its asset
        // 5678-118885.png sits in that frame's assets/ dir.
        source: '<div data-figma-id="5678:118885"/>',
      },
    ];
    const plan = await planFigmaTurn(inputsFor(`import this ${child}`), {
      readFrames: reader(withChild),
    });
    expect(plan.kind).toBe("claude");
    expect(plan.decidedBy).toBe("provenance");
    expect(plan.targetFrame).toBe("01-figma-5678-118876");
  });

  it("a rejecting reader falls through to the importer rather than failing the turn", async () => {
    const plan = await planFigmaTurn(inputsFor(P(1)), {
      readFrames: async () => {
        throw new Error("EACCES");
      },
    });
    expect(plan.kind).toBe("kit-emit");
    expect(plan.decidedBy).toBe("default");
  });

  // A constraint must survive a provenance HIT — it was derived without the
  // reader and does not depend on it. #2's node 5678:118907 is the origin of
  // frame 02-figma-5678-118907 in the live project.
  it("a constraint survives when provenance also resolves", async () => {
    const plan = await planFigmaTurn(inputsFor(P(2)), { readFrames: reader() });
    expect(plan.constraints).toEqual(["single-frame"]);
  });
});

/**
 * THE FALLBACK DIRECTION, AND WHY THERE IS NO RESOLVER TO FALL BACK FROM.
 *
 * The L4 resolver seam — a host-supplied `resolveTurn?: (q) => Promise<Answer>`
 * asked at step 8, whose failure modes all fell back to the generator — was
 * specified, then CUT on measurement (§0). This block is what keeps the cut
 * honest: it pins the two properties the seam existed to guarantee, so they hold
 * by construction of the cascade rather than by construction of a resolver.
 *
 * Re-measured 2026-08-06 before writing these, because the whole question is
 * whether "no resolver" is a real answer or a silent gap. Exactly SIX prompts
 * reach step 8 — the only point a resolver could plug in — and the split is what
 * kills it:
 *
 *   #0  residue  25   "Implement this precisely:"        bare  → must stay deterministic
 *   #37 residue   0   (bare URL)                         bare  → must stay deterministic
 *   #45 residue   0   (bare URL)                         bare  → must stay deterministic
 *   #53 residue   0   (bare URL)                         bare  → must stay deterministic
 *   #25 residue 156   "There must be three buttons …"     prose → wants a model
 *   #32 residue 169   "a user must see this page …"       prose → wants a model
 *
 * So a resolver only helps if something can tell those two groups apart WITHOUT a
 * model — otherwise it must be asked on all six, and the four bare imports lose
 * the 16-26s no-model fast path that is the product's speed advantage. Two
 * candidate gates were measured and both fail:
 *
 *  1. RESIDUE LENGTH. At step 8 the committed must-stay-deterministic strings top
 *     out at 111 and the model-needing prompts start at 156, which LOOKS like a
 *     clean 45-char gap — but it is fit to two positives. Growing the longest
 *     committed BULLETED faithful-copy string by two more bullets of the same
 *     speech act ("- the composer with the send button on the right") takes its
 *     residue to 204, i.e. straight past both. And in the PRIMARY host — no frame
 *     reader, which is the bare Claude Code case — #1 falls through to step 8 at
 *     residue 65 and collides EXACTLY with two committed must-miss strings, also
 *     65: "this frame documents the CSS transition tokens, copy them exactly" and
 *     "Implement this precisely — the confirmation after tapping Delete." Same
 *     number, opposite required destination. This is the banned prose gate (§0)
 *     re-derived at a different point in the cascade; it fails the same way.
 *  2. FIDELITY VOCABULARY (`detectHiFiIntent` as an ask/don't-ask gate). It is
 *     FALSE for 13 of the 30 committed must-stay-deterministic strings that reach
 *     step 8 — including "import this from figma", "bring this in", a bare URL,
 *     and "No need to animate the loader, just draw it as it is in the frame."
 *     Those 13 would all be asked, and with no adapter supplied every one of them
 *     falls to the generator by the rule below. That is the deterministic fidelity
 *     guarantee destroyed in exactly the headless host the design targets.
 *
 * Hence: no resolver, and step 8 is terminal. The generator fallback the seam
 * promised is what a host now gets by not having the seam at all.
 */
describe("planFigmaTurn — the cut resolver seam's guarantees, held by the cascade", () => {
  // GUARANTEE 1 — the fallback DIRECTION (hard constraint 1). When a host
  // capability is missing or broken, the turn must degrade towards the GENERATOR
  // or stay put; it must never gain the LLM-less importer, which would re-create
  // the instruction-loss bug on every hiccup. Every way a host can fail us, in one
  // place: absent, undefined, throwing, hanging-then-rejecting, and returning
  // junk. The reader is the ONLY injected capability, so this is the complete set.
  const brokenReaders: Array<[string, () => Promise<any>]> = [
    ["throws synchronously", () => { throw new Error("EACCES"); }],
    ["rejects", () => Promise.reject(new Error("EACCES"))],
    ["returns null", async () => null],
    ["returns undefined", async () => undefined],
    ["returns a non-array", async () => ({ nope: true })],
    ["returns junk entries", async () => [null, 42, { slug: 7 }, { source: "x" }]],
    ["never settles in time", () => new Promise((r) => setTimeout(() => r([]), 0))],
  ];

  it.each(brokenReaders)(
    "a reader that %s never routes a PROSE-CARRYING turn onto the importer's fixed outcome by accident",
    async (_label, readFrames) => {
      // #1 carries a real complaint. With a WORKING reader it becomes a named
      // edit; with a broken one it degrades to today's behaviour (kit-emit) —
      // never to a wrong frame, and never by throwing.
      const plan = await planFigmaTurn(inputsFor(P(1)), { readFrames: readFrames as any });
      expect(plan.kind).toBe("kit-emit");
      expect(plan.decidedBy).toBe("default");
      expect(plan.targetFrame).toBeUndefined();
      expect(plan.frameCandidates).toBeUndefined();
    },
  );

  // …and a broken reader must not be able to cancel a PURE layer. #30's
  // single-frame constraint is derived with zero I/O, so it has to survive every
  // capability failure above — otherwise the live 2026-08-06 failure would come
  // back whenever a host's file access misbehaved.
  it.each(brokenReaders)(
    "a reader that %s still leaves #30 off the importer (L3 is pure)",
    async (_label, readFrames) => {
      const plan = await planFigmaTurn(inputsFor(P(30)), { readFrames: readFrames as any });
      expect(plan.kind).toBe("claude");
      expect(plan.decidedBy).toBe("constraints");
      expect(plan.constraints).toEqual(["single-frame"]);
    },
  );

  // GUARANTEE 2 — THE LATENCY GUARANTEE the whole design rests on. A bare import
  // must reach the deterministic fast path having consulted NO host capability at
  // all. Asserted on the call count, not just the outcome: a plan can be right
  // while the reader was still woken up, and on a real host that is I/O.
  it("a bare URL consults no host capability whatsoever", async () => {
    const spy = reader();
    const plan = await planFigmaTurn(inputsFor(P(37)), { readFrames: spy });
    expect(plan.kind).toBe("kit-emit");
    expect(plan.decidedBy).toBe("default");
    // Provenance IS consulted for a bare URL (it is how a re-paste is recognised),
    // so the honest assertion is about what it COSTS, not that it never runs:
    // one read, and no divert. If this ever becomes more than one call per turn,
    // the fast path has grown an N+1.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  // ODD INPUT CANNOT BREAK IT. The cascade runs regexes with unbounded `[^.]*`
  // spans (generationIntent's build-intent patterns), so an enormous prompt is a
  // real ReDoS question rather than a theoretical one. Measured: 376KB routes in
  // 10ms. Bounded generously — this asserts "not catastrophic", not a benchmark,
  // so it cannot flake on a loaded CI box.
  it("an enormous prompt routes fast and correctly", async () => {
    // Worst case for the unbounded spans: a build verb, then no period or comma.
    const prompt = `modify ${"the sidebar and ".repeat(25_000)} ${U1}`;
    expect(prompt.length).toBeGreaterThan(400_000);
    const t0 = Date.now();
    const plan = await planFigmaTurn(inputsFor(prompt));
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(["kit-emit", "claude"]).toContain(plan.kind);
  });

  // A prompt that is ITSELF JSON — the shape a resolver's own answer would have.
  // It must be treated as ordinary text, never parsed, and never able to inject a
  // targetFrame: a plan may only name a frame provenance actually found.
  it("a prompt that is itself JSON cannot inject a routing decision", async () => {
    const hostile = JSON.stringify({
      kind: "claude",
      decidedBy: "resolver",
      targetFrame: "99-attacker-frame",
      constraints: ["single-frame"],
      url: U1,
    });
    const plan = await planFigmaTurn(inputsFor(hostile), { readFrames: reader() });
    expect(plan.targetFrame).not.toBe("99-attacker-frame");
    // "single-frame" in a JSON string is not a designer stating a requirement.
    expect(plan.constraints).toEqual([]);
    expect(plan.decidedBy).toBe("default");
  });

  // The word "import" is the deterministic importer's own name, and a designer
  // saying it is the canonical fast-path ask — it must not be read as a command
  // word with special power.
  it("the word 'import' stays ordinary prose", async () => {
    for (const s of ["import this", "import this from figma", "please import"]) {
      const plan = await planFigmaTurn(inputsFor(`${s} ${U1}`), { readFrames: reader([]) });
      expect(plan.kind, s).toBe("kit-emit");
    }
  });

  // Empty / whitespace-only, with a `nodeIds` array a sloppy host filled with
  // junk. `hasFigmaNode` is the scope guard, so these must leave at step 1.
  it("empty and malformed input leaves at the scope guard", async () => {
    for (const odd of ["", "   ", "\n\t"]) {
      const plan = await planFigmaTurn({
        ...inputsFor(odd),
        nodeIds: [null, undefined, "", 0, {}] as any,
      });
      expect(plan.kind).toBe("claude");
      expect(plan.decidedBy).toBe("no-node");
    }
  });

  // NO UNREACHABLE `decidedBy`. Two members ("resolver", "resolver-fallback")
  // outlived the seam's deletion: nothing could emit them, so a caller branching
  // on either was writing dead code against a host capability that does not
  // exist. They are gone, and this asserts the union is exactly what the cascade
  // can actually produce — over the real corpus plus every failure mode above, so
  // it measures the code rather than restating the type.
  it("every decidedBy the cascade emits is one of the six real layers", async () => {
    const REACHABLE = new Set([
      "no-node", "scoped-edit", "legacy-intent", "provenance", "constraints", "default",
    ]);
    const seen = new Set<string>();
    for (const p of corpus.prompts) {
      for (const deps of [undefined, { readFrames: reader() }]) {
        seen.add((await planFigmaTurn(inputsFor(p.text), deps)).decidedBy);
      }
    }
    seen.add(
      (await planFigmaTurn(inputsFor(`${SCOPED_EDIT_MARKER} make it blue ${U1}`))).decidedBy,
    );
    for (const s of seen) expect(REACHABLE, `emitted "${s}"`).toContain(s);
    // And the corpus really does exercise every layer, so this is not vacuous.
    expect([...seen].sort()).toEqual([
      "constraints", "default", "legacy-intent", "no-node", "provenance", "scoped-edit",
    ]);
  });
});
