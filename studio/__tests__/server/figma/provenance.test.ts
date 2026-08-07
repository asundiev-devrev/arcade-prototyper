// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  locateNodeProvenance,
  type FrameSource,
} from "../../../server/figma/provenance";
// parseFigmaUrl from the zero-import LEAF, not figmaCli: these tests assert the
// brain is loadable in a host with no CLI binary, so importing the figmanage
// driver here would make the claim untrue in the file that makes it.
import { parseFigmaUrl } from "../../../server/figma/figmaNodeUrl";

/**
 * The fixtures below are VERBATIM shapes from the live project
 * ~/Library/Application Support/arcade-studio/projects/implement-this-precisely-3/,
 * captured 2026-08-06. Frame 01-figma-5678-118876/index.tsx really does contain
 * `<div data-figma-id="5678:118877" style={{position: "absolute", ...}}>` on line
 * 11, and really does contain five nested-instance ids of the form
 * `data-figma-id="I5678:118877;5346:75923"`. Both facts matter to a different
 * test below, which is why they are copied rather than invented.
 */
const REAL_CHILD_LINE =
  '    <div data-figma-id="5678:118877" style={{position: "absolute", left: "0px", top: "0px", width: "600px", height: "720px", overflow: "hidden"}}>';

const NESTED_ONLY_SOURCE = [
  "export default function FigmaImport() {",
  '  <div data-figma-id="I5678:118877;5346:75923">a</div>',
  '  <div data-figma-id="I5678:118877;5346:75924">b</div>',
  "}",
].join("\n");

function frames(...f: FrameSource[]): () => Promise<FrameSource[]> {
  return async () => f;
}


describe("locateNodeProvenance", () => {
  // The motivating case. Corpus #1 ("You haven't implemented this background
  // blur properly: <url> try again") pasted node-id=5678-118877, which frame
  // 01-figma-5678-118876 ALREADY contained. That makes the turn an EDIT of a
  // frame we can name exactly — with no language understanding, no keyword, and
  // no model call. This is the one prompt in the corpus that this layer fixes.
  it("names the frame containing the pasted node (the real corpus #1 case)", async () => {
    const r = await locateNodeProvenance(
      ["5678:118877"],
      frames({
        slug: "01-figma-5678-118876",
        source: `export default function FigmaImport() {\n${REAL_CHILD_LINE}\n}`,
      }),
    );
    expect(r.kind).toBe("exact");
    expect(r.frameSlug).toBe("01-figma-5678-118876");
  });

  // A NAIVE SUBSTRING SEARCH PASSES A "did you find it" ASSERTION AND FAILS
  // THIS ONE. The live frame carries 5 ids of the form
  // data-figma-id="I5678:118877;5346:75923" — a node nested inside an instance.
  // Searching for the bare id matches all of them, so the match must be
  // ATTRIBUTE-EXACT. Containment is still useful (it locates the frame holding
  // the host instance) but it is a different claim and gets a different kind.
  it("does NOT report `exact` for a nested-instance id (attribute-exact matching)", async () => {
    const r = await locateNodeProvenance(
      ["5678:118877"],
      frames({ slug: "01-figma-5678-118876", source: NESTED_ONLY_SOURCE }),
    );
    expect(r.kind).not.toBe("exact");
    expect(r.kind).toBe("nested");
    expect(r.frameSlug).toBe("01-figma-5678-118876");
  });

  // Verified caveat: the frame's OWN ROOT node id is not in its source at all.
  // 01-figma-5678-118876 was imported from node 5678:118876, and
  // `grep -o '5678[:-]118876' index.tsx` returns NOTHING — the outer wrapper is
  // emitted as a plain position:relative div with no data-figma-id. Re-pasting
  // the original URL is a completely ordinary designer move (corpus #0 is
  // exactly that URL), so without this source provenance silently misses it.
  it("recovers the frame's own root node from the slug (absent from the source)", async () => {
    const r = await locateNodeProvenance(
      ["5678:118876"],
      frames({
        slug: "01-figma-5678-118876",
        source: `export default function FigmaImport() {\n${REAL_CHILD_LINE}\n}`,
      }),
    );
    expect(r.kind).toBe("origin");
    expect(r.frameSlug).toBe("01-figma-5678-118876");
  });

  it("honours a host-declared importedFromNodeId even when the slug says nothing", async () => {
    const r = await locateNodeProvenance(
      ["9:1"],
      frames({ slug: "03-hand-named-frame", source: "<div/>", importedFromNodeId: "9:1" }),
    );
    expect(r.kind).toBe("origin");
    expect(r.frameSlug).toBe("03-hand-named-frame");
  });

  // A sibling-node collision. Node ids are variable-length digit strings and
  // frame slugs carry a two-digit prefix, so a substring/prefix comparison
  // between them collides: '01-figma-5678-118876'.includes('figma-5678-11887')
  // is TRUE. Naming the WRONG frame is worse than naming none — the generator
  // would confidently edit a frame the designer wasn't talking about — so the
  // slug comparison must be exact after stripping the numeric prefix.
  it("refuses a slug PREFIX collision between sibling node ids", async () => {
    const r = await locateNodeProvenance(
      ["5678:11887"], // a real sibling of 5678:118876, one digit shorter
      frames({ slug: "01-figma-5678-118876", source: "<div/>" }),
    );
    expect(r.kind).toBe("none");
    expect(r.frameSlug).toBeUndefined();
  });

  // The COMMON case today, and the reason "refuse to guess" is load-bearing
  // rather than theoretical. data-figma-id is written only by the deterministic
  // importer: verified across all 11 live projects, exactly 2 frame files in 1
  // project carry it. Every LLM-written frame has none, forever.
  it("returns kind 'none' with NO frameSlug when nothing matches", async () => {
    const r = await locateNodeProvenance(
      ["5678:118877"],
      frames({
        slug: "01-llm-written-frame",
        source: "export default function Screen() { return <div className='p-4'>hi</div>; }",
      }),
    );
    expect(r.kind).toBe("none");
    // Assert the property is ABSENT, not empty-string — a caller does
    // `if (plan.targetFrame)` and "" would silently behave the same as absent
    // here but not everywhere.
    expect(r.frameSlug).toBeUndefined();
    expect("frameSlug" in r ? r.frameSlug : undefined).toBeUndefined();
  });

  // Two frames containing the same node. Rare (the two live frames in
  // implement-this-precisely-3 share ZERO ids — comm -12 on their sorted id sets
  // is empty) but a designer who imports the same node twice creates it
  // immediately. We know it is an edit of SOMETHING we rendered; we do not know
  // of what, so we must not pick.
  it("refuses to name a frame when the node is in TWO frames", async () => {
    const src = `export default function FigmaImport() {\n${REAL_CHILD_LINE}\n}`;
    const r = await locateNodeProvenance(
      ["5678:118877"],
      frames(
        { slug: "01-figma-5678-118876", source: src },
        { slug: "02-figma-5678-118876-again", source: src },
      ),
    );
    expect(r.kind).toBe("ambiguous");
    expect(r.frameSlug).toBeUndefined();
    expect(r.candidates).toEqual(["01-figma-5678-118876", "02-figma-5678-118876-again"]);
  });

  // Proves parseFigmaUrl's dash→colon normalisation is doing the work and that no
  // second URL parser crept into this module. The `&t=<share token>` is simply
  // never read, which the existing dedup comment at chat.ts:799-805 already
  // depends on.
  it("resolves the dash form, the &t= form, and the colon form identically", async () => {
    const src = `export default function FigmaImport() {\n${REAL_CHILD_LINE}\n}`;
    const reader = frames({ slug: "01-figma-5678-118876", source: src });
    const urls = [
      "https://www.figma.com/design/ssU/Onboarding-3.0?node-id=5678-118877",
      "https://www.figma.com/design/ssU/Onboarding-3.0?node-id=5678-118877&t=2Dpcget8xJwUoFhQ-11",
    ];
    for (const u of urls) {
      const nodeId = parseFigmaUrl(u)?.nodeId;
      expect(nodeId, u).toBe("5678:118877");
      const r = await locateNodeProvenance([nodeId!], reader);
      expect(r.kind, u).toBe("exact");
    }
    // Already-colon form, passed straight through.
    expect((await locateNodeProvenance(["5678:118877"], reader)).kind).toBe("exact");
  });

  // A provenance failure must NEVER fail a turn. The caller has no try block by
  // design, so the module swallows.
  it("treats a rejecting reader as 'none' and does not throw", async () => {
    const r = await locateNodeProvenance(["5678:118877"], async () => {
      throw new Error("EACCES");
    });
    expect(r.kind).toBe("none");
  });

  // THE READER'S RETURN VALUE IS UNTRUSTED HOST INPUT. `?? []` used to be the
  // only guard here, which catches null/undefined and lets every other non-array
  // reach `.filter` — a TypeError that escapes to the caller, and callers have no
  // try block by design, so it failed the entire turn rather than the layer. Found
  // by a routing test, not by review. These are the plausible foreign-host
  // mistakes: one frame handed back unwrapped, a Map, a JSON string left unparsed.
  it.each([
    ["a single object, unwrapped", { slug: "01-x", source: "<div/>" }],
    ["a Map", new Map([["01-x", "<div/>"]])],
    ["an unparsed JSON string", '[{"slug":"01-x","source":"<div/>"}]'],
    ["a number", 42],
    ["a boolean", true],
  ])("survives a reader returning %s", async (_label, got) => {
    const r = await locateNodeProvenance(["5678:118877"], (async () => got) as any);
    expect(r.kind).toBe("none");
  });

  it("returns 'none' for an empty node list without calling the reader", async () => {
    const reader = vi.fn(async () => []);
    const r = await locateNodeProvenance([], reader);
    expect(r.kind).toBe("none");
    expect(reader).not.toHaveBeenCalled();
  });

  // Bound the cost. A designer with 30 frames must not pay an unbounded scan on
  // every Figma turn that reaches this layer.
  it("skips a source over 1MB rather than scanning it", async () => {
    const huge = "x".repeat(1_100_000) + REAL_CHILD_LINE;
    const r = await locateNodeProvenance(
      ["5678:118877"],
      frames({ slug: "01-huge", source: huge }),
    );
    expect(r.kind).toBe("none");
  });

  it("is robust to a frame with a missing/non-string source", async () => {
    const r = await locateNodeProvenance(
      ["5678:118877"],
      frames({ slug: "01-broken", source: undefined as unknown as string }),
    );
    expect(r.kind).toBe("none");
  });

  // Multiple URLs in one prompt: a node with a hit is found wherever it sits in
  // the list.
  it("checks every pasted node and reports the one that resolves", async () => {
    const src = `export default function FigmaImport() {\n${REAL_CHILD_LINE}\n}`;
    const r = await locateNodeProvenance(
      ["1:1", "5678:118877"],
      frames({ slug: "01-figma-5678-118876", source: src }),
    );
    expect(r.kind).toBe("exact");
    expect(r.frameSlug).toBe("01-figma-5678-118876");
  });

  // PRIORITY BEATS PASTE ORDER, and this was a real bug found by adversarial
  // review. The first cut iterated nodeIds in the OUTER loop and the three
  // sources in the INNER position, so the FIRST pasted URL settled the result
  // even when a LATER URL matched more strongly. Combined with the rule that
  // `origin` never diverts a turn (turnRouting.ts step 6), a weak `origin` hit on
  // URL#1 SHADOWED a divertible `exact` hit on URL#2 — and the whole turn fell
  // back to the LLM-less importer, discarding the correction. Whether the
  // motivating bug class got fixed depended on the order the designer happened to
  // paste two links, which is not a thing a designer can know.
  //
  // The world below is the realistic one: a frame imported from root 36:7860
  // (so its SLUG origin-matches, while its own root id is absent from the source
  // — verified caveat 1) which DRAWS child 36:7861.
  it("prefers the strongest source across ALL pasted nodes, in either paste order", async () => {
    const world = frames({
      slug: "01-figma-36-7860",
      source: '<div data-figma-id="36:7861"/>',
    });
    const rootFirst = await locateNodeProvenance(["36:7860", "36:7861"], world);
    const childFirst = await locateNodeProvenance(["36:7861", "36:7860"], world);
    // `exact` in BOTH orders — the child is drawn inside the frame, which is the
    // strongest claim available, and it must win over the weaker `origin` hit no
    // matter which URL the designer pasted first.
    expect(rootFirst.kind, "root pasted first").toBe("exact");
    expect(childFirst.kind, "child pasted first").toBe("exact");
    expect(rootFirst).toEqual(childFirst);
  });

  // One frame matching TWO pasted ids is still ONE candidate. Without
  // de-duplication per source, the cross-node search below would collect the same
  // slug twice and report `ambiguous` — refusing to name a frame it had in fact
  // identified unambiguously, which is a silent downgrade of the fix.
  it("does not become ambiguous when one frame matches two pasted nodes", async () => {
    const r = await locateNodeProvenance(
      ["5678:118877", "5678:118878"],
      frames({
        slug: "01-figma-5678-118876",
        source:
          '<div data-figma-id="5678:118877"/><div data-figma-id="5678:118878"/>',
      }),
    );
    expect(r.kind).toBe("exact");
    expect(r.frameSlug).toBe("01-figma-5678-118876");
  });

  // Two pasted nodes that are exact hits in DIFFERENT frames is genuinely
  // ambiguous — we know it is an edit of something we rendered, not of what.
  it("reports ambiguous when two pasted nodes hit two different frames", async () => {
    const r = await locateNodeProvenance(
      ["5678:118877", "5678:118908"],
      frames(
        { slug: "01-figma-5678-118876", source: '<div data-figma-id="5678:118877"/>' },
        { slug: "02-figma-5678-118907", source: '<div data-figma-id="5678:118908"/>' },
      ),
    );
    expect(r.kind).toBe("ambiguous");
    expect(r.frameSlug).toBeUndefined();
    expect(r.candidates).toEqual(["01-figma-5678-118876", "02-figma-5678-118907"]);
  });
});

/**
 * FIGMA NODE IDS ARE ONLY UNIQUE WITHIN A FILE.
 *
 * Verified 2026-08-06, not hypothesised: of the 11 live projects, one
 * (`polina-s-prototype`) references TWO Figma files — `EAo4gdFvjvzXnmL8hX6Ctc` and
 * `JztJjqt3i6uFwB6r4dfewz` — and the corpus itself spans three (`ssUerkBL…`,
 * `EAo4gdFv…`, `JztJjqt3…`). So a node pasted from file B whose id happens to
 * collide with a node imported from file A would be read as an edit of A's frame:
 * the generator then edits a frame the designer was not talking about, which is
 * the failure this module's whole "refuse to guess" discipline exists to prevent.
 *
 * The file key is OPTIONAL on both sides, and that asymmetry is deliberate: it is
 * a filter, never a requirement. A host that cannot tell us the file key (any
 * frame written before this landed, an LLM-authored frame, a Claude Code host
 * handing over loose files) keeps today's behaviour rather than losing provenance
 * entirely.
 */
describe("locateNodeProvenance — file scoping", () => {
  const SRC = '<div data-figma-id="36:7861"/>';

  it("does NOT match a colliding node id from a DIFFERENT Figma file", async () => {
    const r = await locateNodeProvenance(
      [{ nodeId: "36:7861", fileKey: "JztJjqt3i6uFwB6r4dfewz" }],
      frames({ slug: "01-tabbed-canvas", source: SRC, fileKey: "EAo4gdFvjvzXnmL8hX6Ctc" }),
    );
    expect(r.kind).toBe("none");
    expect(r.frameSlug).toBeUndefined();
  });

  it("matches when the file keys agree", async () => {
    const r = await locateNodeProvenance(
      [{ nodeId: "36:7861", fileKey: "EAo4gdFvjvzXnmL8hX6Ctc" }],
      frames({ slug: "01-tabbed-canvas", source: SRC, fileKey: "EAo4gdFvjvzXnmL8hX6Ctc" }),
    );
    expect(r.kind).toBe("exact");
    expect(r.frameSlug).toBe("01-tabbed-canvas");
  });

  // DEGRADE, don't disappear. Every one of these is a real shape on disk today.
  it("still matches when EITHER side does not know its file key", async () => {
    // Host knows the frame's file, prompt side does not (bare id, back-compat).
    expect(
      (
        await locateNodeProvenance(
          ["36:7861"],
          frames({ slug: "01-a", source: SRC, fileKey: "EAo4gdFvjvzXnmL8hX6Ctc" }),
        )
      ).kind,
    ).toBe("exact");
    // Prompt side knows, frame does not (an LLM-written or pre-existing frame).
    expect(
      (
        await locateNodeProvenance(
          [{ nodeId: "36:7861", fileKey: "EAo4gdFvjvzXnmL8hX6Ctc" }],
          frames({ slug: "01-a", source: SRC }),
        )
      ).kind,
    ).toBe("exact");
  });

  // File scoping must apply to `origin` too — that is the source most likely to
  // collide, because it matches on the SLUG, and two files' frames can produce
  // byte-identical slugs.
  it("scopes the origin source by file key as well", async () => {
    const r = await locateNodeProvenance(
      [{ nodeId: "36:7860", fileKey: "JztJjqt3i6uFwB6r4dfewz" }],
      frames({
        slug: "01-figma-36-7860",
        source: "<div/>",
        fileKey: "EAo4gdFvjvzXnmL8hX6Ctc",
      }),
    );
    expect(r.kind).toBe("none");
  });
});

/**
 * ONE FRAME, SEVERAL FILES.
 *
 * A frame dir is not always just `index.tsx`. The WIRE branch imports the overlay
 * design as a sibling `Overlay.tsx` inside the SAME frame dir
 * (`entryFileName: "Overlay.tsx"`, chat.ts:1722) through the same emitter that
 * stamps `data-figma-id`. So an overlay's nodes live in a non-index file, and a
 * designer correcting the overlay mid-iteration — exactly the branch where
 * provenance matters most — would otherwise miss entirely.
 *
 * Verified 2026-08-06: 11 non-index `.tsx` files exist inside live frame dirs,
 * including `wire-test/frames/01-figma-3814-30541/Overlay.tsx`. (That particular
 * file predates `data-figma-id`, so it carries none — but every wire import from
 * now on does.)
 *
 * Enumeration is the HOST reader's job; the pure layer just has to collapse
 * several files of one frame into ONE candidate rather than calling it ambiguous.
 * The contract that makes that work is: the host sets `slug` to the FRAME slug for
 * every file it hands over.
 */
describe("locateNodeProvenance — several files per frame", () => {
  it("collapses two files of the SAME frame into one candidate, not ambiguous", async () => {
    const r = await locateNodeProvenance(
      ["3814:30925"],
      frames(
        // index.tsx — the screen. Does not contain the overlay's node.
        { slug: "01-figma-3814-30541", source: '<div data-figma-id="3814:30542"/>' },
        // Overlay.tsx — same frame slug, different file, holds the pasted node.
        { slug: "01-figma-3814-30541", source: '<div data-figma-id="3814:30925"/>' },
      ),
    );
    expect(r.kind).toBe("exact");
    expect(r.frameSlug).toBe("01-figma-3814-30541");
  });

  it("still reports ambiguous across two genuinely DIFFERENT frames", async () => {
    const r = await locateNodeProvenance(
      ["3814:30925"],
      frames(
        { slug: "01-figma-3814-30541", source: '<div data-figma-id="3814:30925"/>' },
        { slug: "02-other-frame", source: '<div data-figma-id="3814:30925"/>' },
      ),
    );
    expect(r.kind).toBe("ambiguous");
    expect(r.candidates).toEqual(["01-figma-3814-30541", "02-other-frame"]);
  });
});
