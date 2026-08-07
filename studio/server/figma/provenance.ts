/**
 * Has this Figma node ALREADY been rendered into one of the project's frames?
 *
 * If yes, the turn is an EDIT of that frame and we know the frame by name — with
 * no language understanding, no keyword, and no model call. That is corpus #1
 * exactly: "You haven't implemented this background blur properly: <url> try
 * again" pasted node-id=5678-118877, a node frame 01-figma-5678-118876 already
 * contained. Today that turn routes to the deterministic importer, which has no
 * LLM, so it stamps a BRAND NEW frame and narrates about the new import instead
 * of fixing the blur (live session 2026-08-06).
 *
 * The signal is a filesystem fact rather than an interpretation: the deterministic
 * importer stamps `data-figma-id` on every emitted child node
 * (`figmaIdAttr`, server/figma/kitEmit.ts), so "was this node already imported"
 * is an attribute lookup. That is why this layer catches a CORRECTION without
 * detecting corrections — which is banned here, and rightly (a correction is a
 * speech act; see the long note at case 4 in turnRouting.ts).
 *
 * HOST-AGNOSTIC BY CONSTRUCTION. This module reads frames through an INJECTED
 * accessor and never touches the filesystem itself. It must not import node:fs,
 * server/paths, node:child_process, or read process.env — a static guard in
 * __tests__/server/figma/headlessRouting.test.ts enforces that, including
 * transitively. Studio binds the accessor in its middleware; a Claude Code host
 * hands over files it already has in context. Compare `import-hook-dead-in-dmg`:
 * a dev-only path silently disabled a whole feature on tester machines.
 *
 * FIVE VERIFIED CAVEATS shape the matching below (all measured 2026-08-06
 * against the live projects, not assumed):
 *
 *  1. The frame's own ROOT node id is NOT in its source. 01-figma-5678-118876 was
 *     imported from 5678:118876 and `grep -o '5678[:-]118876' index.tsx` returns
 *     nothing — the outer wrapper is a plain position:relative div with no
 *     attribute. Re-pasting the original URL is an ordinary designer move, so
 *     source 3 recovers it from the slug.
 *  2. `data-figma-id` is written only by the deterministic importer. Across all
 *     11 live projects, exactly 2 frame files in 1 project carry it; LLM-written
 *     frames never will. So a MISS is the common case and "refuse to guess" is
 *     load-bearing, not theoretical.
 *  3. Nested-instance ids exist: the same live file has 5 attributes of the form
 *     `data-figma-id="I5678:118877;5346:75923"`. A substring search for the bare
 *     id matches all of them, so identity matching must be attribute-EXACT and
 *     containment must be reported as a different kind.
 *  4. NODE IDS ARE ONLY UNIQUE WITHIN A FIGMA FILE, and multi-file projects are
 *     real: `polina-s-prototype` references two files, and the 13 Figma prompts in
 *     the corpus span three. Hence the optional file-key filter (see NodeRef).
 *  5. A FRAME IS NOT ALWAYS ONE FILE. The wire branch writes the overlay design as
 *     a sibling `Overlay.tsx` in the same frame dir through the same stamping
 *     emitter, and 11 non-index `.tsx` files exist inside live frame dirs today.
 *     So several FrameSource entries may share one slug, and `settle` collapses
 *     them instead of calling the frame ambiguous with itself.
 *
 * A CHILD HIT MEANS "EDIT THE PARENT FRAME", and that is a decision rather than
 * an oversight. The importer stamps an attribute on EVERY emitted node (25 of them
 * in the live frame 01), so pasting a child is an `exact` hit and diverts to an
 * edit of the frame that draws it. The competing reading — "import this
 * sub-component as its own frame" — is also a real designer move, so the choice is
 * made on what each mistake costs. A wrong edit is visible, lands in a NAMED
 * frame, and one follow-up turn undoes it. The status quo, i.e. what happens
 * without this layer, silently stamps a duplicate frame and discards every word
 * the designer typed — which is exactly how corpus #30/#31 played out live: the
 * designer's next turn is them explaining the failure back to us. There is also an
 * unambiguous escape from the branch we chose (import the sub-component in a new
 * project; provenance is per-project by construction) and none from the other.
 * Pinned in __tests__/server/figma/planFigmaTurn.test.ts.
 *
 * A NOTE ON `nested`, so nobody mistakes it for load-bearing: measured across
 * every live importer-produced frame, the set of ids reachable ONLY via
 * containment is EMPTY — the importer emits a plain attribute for each nested
 * host as well, so `matchExact` always settles first, and pasting the nested id
 * itself (`I5678:118877;5346:75923`) is an exact match too. It is kept as a
 * DEFENSIVE source for hand-edited or future emitter output, not because anything
 * exercises it. Treat it accordingly: it is not evidence that a third source
 * would pay for itself.
 *
 * Unit-tested in __tests__/server/figma/provenance.test.ts.
 */
import { slugMatchesNode } from "./frameSlug";

/** One rendered frame FILE, as the HOST can see it. `slug` is whatever the host
 *  calls the frame; `source` is the rendered file's text. Nothing Studio-specific.
 *
 *  A frame may be handed over as SEVERAL entries — the wire branch writes both
 *  `index.tsx` and a sibling `Overlay.tsx` into one frame dir, and the overlay's
 *  nodes only exist in the latter. When it does, every entry carries the same
 *  `slug` (the FRAME slug) and they collapse to one candidate. Enumerating the
 *  files is the host reader's job; this module iterates what it is handed. */
export interface FrameSource {
  slug: string;
  source: string;
  /** Optional: the Figma node this frame was imported from, when the host knows
   *  it independently of the source text (Studio: the frame slug / LIFT.json). */
  importedFromNodeId?: string;
  /** Optional: the Figma FILE this frame came from. Node ids are only unique
   *  within a file, so when both sides know their file key a mismatch is a
   *  guaranteed non-match. Optional on purpose — see NodeRef. */
  fileKey?: string;
}

/**
 * A pasted node. The bare-string form is the back-compatible one; the object form
 * additionally scopes the match to a Figma FILE.
 *
 * Why file scoping matters, measured 2026-08-06 rather than imagined: Figma node
 * ids are only unique WITHIN a file, and multi-file projects already exist on disk
 * — `polina-s-prototype` references both `EAo4gdFvjvzXnmL8hX6Ctc` and
 * `JztJjqt3i6uFwB6r4dfewz`, and the 13 Figma prompts in the corpus span three
 * files. A colliding id from a different file would be read as an edit of the
 * wrong frame, and the generator would edit it without hesitating.
 *
 * The key is optional on BOTH sides deliberately: it FILTERS, it is never
 * REQUIRED. A host that cannot say which file a frame came from (an LLM-authored
 * frame, a Claude Code host handing over loose files) keeps today's behaviour
 * rather than losing provenance altogether.
 */
export type NodeRef = string | { nodeId: string; fileKey?: string };

/** The host supplies the frames. Studio reads them off disk; a Claude-Code host
 *  hands over files it already has in context. That is the entire contract —
 *  two lines to implement, and no Studio vocabulary in it. */
export type FrameSourceReader = () => Promise<FrameSource[]>;

export type ProvenanceMatchKind = "none" | "exact" | "nested" | "origin" | "ambiguous";

export interface ProvenanceResult {
  kind: ProvenanceMatchKind;
  /** Set ONLY for exact | nested | origin. NEVER set for none | ambiguous. */
  frameSlug?: string;
  /** Set only for ambiguous. */
  candidates?: string[];
  /** Which source produced an `ambiguous` result. Callers treat the sources
   *  differently — see the `origin` note below — so collapsing them all into
   *  "ambiguous" would lose the distinction that decides routing. */
  via?: "exact" | "nested" | "origin";
}

/**
 * Cap on a single frame source we are willing to scan. A designer with 30 frames
 * must not pay an unbounded scan on every Figma turn that reaches this layer, and
 * a pathological generated file should be skipped rather than block the turn.
 */
const MAX_SOURCE_BYTES = 1_000_000;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A pasted node's id plus, if the host knew it, the file it came from.
 * Normalising here means every matcher below sees one shape.
 */
interface NormalisedRef {
  nodeId: string;
  fileKey?: string;
}

/**
 * True unless BOTH sides know their file key and the keys disagree. A missing key
 * on either side is "unknown", never "mismatch" — see NodeRef for why that
 * asymmetry is deliberate.
 */
function fileKeyAllows(frame: FrameSource, ref: NormalisedRef): boolean {
  if (!frame.fileKey || !ref.fileKey) return true;
  return frame.fileKey === ref.fileKey;
}

/**
 * Sources checked in priority order. Each returns the slugs of every frame that
 * matches, so the caller can distinguish "exactly one" from "ambiguous".
 */
function matchExact(frames: FrameSource[], ref: NormalisedRef): string[] {
  // Attribute EQUALITY, not substring — this is what rejects the nested-instance
  // form `data-figma-id="I5678:118877;5346:75923"` (caveat 3).
  const re = new RegExp(`data-figma-id="${escapeRegExp(ref.nodeId)}"`);
  return frames.filter((f) => fileKeyAllows(f, ref) && re.test(f.source)).map((f) => f.slug);
}

function matchNested(frames: FrameSource[], ref: NormalisedRef): string[] {
  // A node pasted from inside an instance has id `I<host>;<inner>`. Matching the
  // prefix finds the frame containing the HOST instance — containment, not
  // identity, which is why the caller reports it under a different kind.
  const re = new RegExp(`data-figma-id="I${escapeRegExp(ref.nodeId)};`);
  return frames.filter((f) => fileKeyAllows(f, ref) && re.test(f.source)).map((f) => f.slug);
}

/**
 * Source 3: the frame this node was IMPORTED FROM.
 *
 * CALLERS MUST TREAT THIS DIFFERENTLY FROM `exact`/`nested`, and the reason is
 * measured. `exact` means "the designer pasted a node that is DRAWN INSIDE an
 * existing frame", which is strong evidence of an edit — corpus #1. `origin` means
 * "the designer re-pasted the URL the frame was made from", which is exactly what
 * a plain re-import looks like: corpus #0 is the verbatim string
 * "Implement this precisely: <url>" pointing at the root of 01-figma-5678-118876.
 *
 * Measured across the 13 corpus Figma prompts against the live frames: `origin`
 * fires on #0 and #2 only. #2 escapes the importer anyway (interaction intent +
 * a single-frame constraint), and #0 is a bare import that MUST stay on the fast
 * path. So `origin` is the ONLY escape for exactly zero prompts, and treating it
 * as an edit-divert would break the deterministic fast path — the product's speed
 * advantage — to fix nothing at all.
 *
 * It is still worth computing: naming the frame lets the caller say "this node
 * already came in as <slug>" on a turn that routes to the generator for some other
 * reason. It just must not, on its own, take a turn off the importer.
 */
function matchOrigin(frames: FrameSource[], ref: NormalisedRef): string[] {
  return frames
    .filter(
      (f) =>
        fileKeyAllows(f, ref) &&
        (f.importedFromNodeId === ref.nodeId || slugMatchesNode(f.slug, ref.nodeId)),
    )
    .map((f) => f.slug);
}

function settle(kind: "exact" | "nested" | "origin", slugs: string[]): ProvenanceResult | null {
  // DE-DUPLICATE FIRST. Two things legitimately produce a repeated slug: one frame
  // matching two of the pasted node ids, and one frame handed over as several
  // files (index.tsx + Overlay.tsx, which the wire branch really does write).
  // Without this, either would be reported `ambiguous` — refusing to name a frame
  // we had in fact identified unambiguously, i.e. a silent downgrade of the fix.
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return null;
  // Naming the WRONG frame is worse than naming none: the generator edits it
  // without hesitating. So 2+ DISTINCT frames names nothing and hands over the
  // candidates.
  if (unique.length > 1) return { kind: "ambiguous", candidates: unique, via: kind };
  return { kind, frameSlug: unique[0], via: kind };
}

/**
 * Locate the frame a pasted node already lives in.
 *
 * `nodes` are colon-form ids from `parseFigmaUrl` (which already normalises
 * dash → colon and ignores the `&t=` share token — do NOT write a second
 * parser), optionally paired with the Figma file key (see NodeRef).
 *
 * PRIORITY BEATS PASTE ORDER. The strongest source is checked across ALL pasted
 * nodes before the next source is considered. The first cut had these loops the
 * other way round — nodes outer, sources inner — so the FIRST pasted URL settled
 * the result even when a LATER one matched more strongly. Combined with the rule
 * that `origin` never diverts a turn, a weak `origin` hit on URL#1 shadowed a
 * divertible `exact` hit on URL#2 and the whole turn fell back to the LLM-less
 * importer. Whether the bug got fixed then depended on the order the designer
 * happened to paste two links — not something a designer can know or control.
 *
 * NEVER THROWS. A provenance failure must not fail a turn, so a rejecting reader
 * is treated as "no signal" and the cascade continues. Callers have no try block
 * by design.
 */
export async function locateNodeProvenance(
  nodes: NodeRef[],
  readFrames: FrameSourceReader,
): Promise<ProvenanceResult> {
  const refs: NormalisedRef[] = (Array.isArray(nodes) ? nodes : [])
    .map((n) =>
      typeof n === "string"
        ? { nodeId: n }
        : n && typeof n.nodeId === "string"
        ? { nodeId: n.nodeId, fileKey: typeof n.fileKey === "string" ? n.fileKey : undefined }
        : null,
    )
    .filter((r): r is NormalisedRef => Boolean(r && r.nodeId.length > 0));
  if (refs.length === 0) return { kind: "none" };

  let all: FrameSource[];
  try {
    const got = await readFrames();
    // `?? []` alone was NOT enough, and a test found it: it catches null and
    // undefined but lets any OTHER non-array through to `.filter` below, which
    // throws a TypeError and — because callers deliberately have no try block
    // (see the NEVER THROWS note above) — fails the whole turn. The accessor is
    // implemented by the HOST, so its return value is untrusted input: a Claude
    // Code / Cursor host handing back a single object, a Map, or a JSON blob it
    // forgot to parse is a plausible mistake, and the cost of it must be "no
    // provenance signal", never "the designer's turn died". Same reasoning as the
    // per-entry normalisation immediately below, applied one level up.
    all = Array.isArray(got) ? got : [];
  } catch {
    return { kind: "none" };
  }

  // Normalise defensively: a host may hand us a frame whose file was unreadable.
  const frames = all.filter(
    (f) =>
      f &&
      typeof f.slug === "string" &&
      typeof f.source === "string" &&
      f.source.length <= MAX_SOURCE_BYTES,
  );
  // NB: `origin` matching only needs the slug, but a frame whose source we
  // refused to read is also a frame we cannot honestly claim to have inspected,
  // so it is excluded from every source. That keeps "we found it" meaning one
  // thing.
  if (frames.length === 0) return { kind: "none" };

  // Source-major, node-minor — the order the doc comment above promises and the
  // same order as `settle`'s own exact → nested → origin chain.
  const across = (m: (fs: FrameSource[], r: NormalisedRef) => string[]) =>
    refs.flatMap((r) => m(frames, r));

  return (
    settle("exact", across(matchExact)) ??
    settle("nested", across(matchNested)) ??
    settle("origin", across(matchOrigin)) ?? { kind: "none" }
  );
}
