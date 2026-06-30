# Overlay Tweaks — Direct Visual Editing of Rendered Prototypes — Design

**Date:** 2026-06-29
**Status:** SUPERSEDED (do not implement) — an adversarial code-level review found
the overlay's structural anchor silently re-applies to the wrong node on
live-mutating composites, and Commit structurally cannot write composite-internal
tweaks to code (kit source is shared/forbidden; baked content has no frame-source
location). Root cause: scene composites bake CONTENT as internal constants. The
real fix is at generation — make scene composites data-driven so content lives in
the frame. Superseded by `2026-06-29-data-driven-composites-design.md`.
**Product:** Arcade Studio (`studio/`)

## Problem

Five consecutive editing approaches failed (detach → props-first → auto-expand →
props-panel), all on the same assumption: that editing means mapping a clicked
element back to a location in the frame's source. For a generated prototype
that's a self-contained interactive composite — `<ComputerScene />` is literally
one line; every message, session, and label is baked inside the shipped
component — there is **nothing in the frame source to map a click to**. The
panel showed the same handful of wrapper props no matter what you clicked, and
every real change you wanted (recolor a bubble, fix a message's text) routed
through the LLM with latency and friction. Verdict from the designer: "absolutely
no value."

The reframing that breaks the curse, from the designer:

> "Whatever I can SEE, I can tweak." + the friction is **latency and
> imprecision, not capability** — fast, precise tweaks. + "I must be able to
> explore quickly and freely, but then commit when I'm happy with the direction
> — that's the point where rough tweaks become clean code." + "not every
> prototype will need committing."

This is a **direct-manipulation** job on **rendered pixels**, NOT a
map-to-source job. The rendered prototype is real DOM in the browser — every
visible node exists whether it came from frame source or from inside a
composite. A "change this text / color / show-hide" tweak applies directly to
that DOM node. The source-mapping wall is sidestepped: it only appears once, at
an optional Commit step, with the whole change-set as context.

## The model — two phases

```
EXPLORE  (instant · no LLM · never touches source)
  click any rendered element (real DOM node — composite-internal OR frame-authored)
    → ANCHOR it (stable structural key from rendered-tree position + discriminators)
    → tweak: edit text | restyle (color / size / spacing) | show-hide
    → tweak written to a per-frame sidecar (tweaks.json)
    → APPLY RUNTIME re-applies the full tweak set on every render
  tweaks persist across reload AND ship in the shared/exported prototype
  a "Tweaks (N)" list — each discardable individually or all; stale ones flagged

COMMIT  (optional · per-prototype · one deliberate batched LLM step · trigger TBD)
  "Commit tweaks" (trigger UI decided later — share menu / button / other)
    → send { frame source + the full tweak set, each as anchor→change } to the agent ONCE
    → agent bakes the tweaks into clean code in the real source
    → sidecar cleared (code is now the truth); frame re-renders identical pixels
```

Explore is the everyday product (most prototypes are throwaway and never
commit). Commit is first-class but optional; only its *trigger UI* is deferred.
v1 keeps the tweak set in a clean, machine-readable form so Commit consumes it
with zero rework.

### Decisions locked during brainstorming

- **Approach A — overlay by stable structural anchor** (not fiber-key, not
  live-DOM-serialize). Explore never reads/writes source → the source-mapping
  wall is out of the hot path. Works uniformly on ANY visible node.
- **Core job:** fast precise tweaks; friction is latency + imprecision.
- **Reach:** whatever is rendered/visible is tweakable — composite-internal
  included. The source-vs-composite distinction is the system's problem, made
  invisible to the designer.
- **v1 tweak kinds:** edit text, restyle (color / font size+weight / spacing),
  show-hide. Move/reorder is OUT of v1 (needs layout-level overlay expression).
- **Persistence:** per-frame sidecar (`tweaks.json`), survives reload, ships in
  the shared/exported prototype.
- **Commit is in v1** (both phases designed now) — only the commit *trigger* is
  TBD. Optional per-prototype.
- **Stale anchor → skip + flag** in the tweak list. Never silently wrong, never
  crash, no data loss. (No auto-drop, no fuzzy re-anchor.)
- **Apply runtime ships everywhere the frame renders** — injected at frame-mount
  for the Studio preview AND bundled on export, so shared prototypes carry
  tweaks.

## Key structural fact (why this works where 5 attempts failed)

Prior attempts asked "where in the SOURCE is this click?" — unanswerable for a
baked-in element. This asks "which rendered DOM NODE is this click?" — always
answerable, because the node is right there. The anchor is computed from the
live rendered tree, not from source. Source is touched exactly once, at Commit,
where the agent has the whole tweak set and can write clean code in one pass —
the easy direction, not the per-click impossible one.

## Architecture

```
Studio preview iframe (existing frame-mount)
  ├─ APPLY RUNTIME (injected) ── on load + on re-render: read sidecar, re-apply each tweak
  └─ AUTHORING RUNTIME (Studio only) ── Explore mode:
        click → compute anchor → tweak control (text / restyle / show-hide)
              → write tweak to sidecar (POST /api/tweaks/:slug)
              → apply runtime reflects it instantly (no reload, no LLM)

Sidecar:  projects/<slug>/frames/<frameSlug>/tweaks.json   (plain JSON, machine-readable)

Share / export bundler ── includes the apply runtime script + tweaks.json
        → shared prototype renders WITH tweaks, outside Studio

Commit (optional, trigger TBD) ── POST a commit → agent turn:
        { frame index.tsx + tweaks.json } → bake into clean source → clear sidecar
```

### New / changed units

1. **Anchor module** (`studio/src/overlay/anchor.ts`, pure, browser+node-safe) —
   - `computeAnchor(root: Element, el: Element): string` — walk root→el; each
     step = `tagName` + `:nth-of-type(k)` among siblings, augmented with a
     stable discriminator when available, in priority order: a kit `data-*`
     identity attr → an ARIA `role` → a short trimmed text fingerprint (first
     ~24 chars, normalized). Returns the path string.
   - `resolveAnchor(root: Element, anchor: string): { el: Element | null;
     ambiguous: boolean }` — resolve the path against the live DOM; `el=null`
     when unresolved (→ skip+flag); `ambiguous=true` when the path matches >1
     node (take first, low-confidence flag). Pure DOM, no React, no source.

2. **Tweak model** (`studio/src/overlay/tweak.ts`) —
   `interface Tweak { id: string; anchor: string; kind: "text" | "style" |
   "hidden"; payload: TweakPayload; createdAt: string }` where
   `TweakPayload = { text: string } | { style: Record<string,string> } |
   { hidden: true }`. Plus a `TweakSet` = `{ version: 1; tweaks: Tweak[] }`.
   Pure helpers: `addOrReplace(set, tweak)` (one tweak per anchor+kind; a second
   style tweak on the same node MERGES style props), `remove(set, id)`,
   `clear(set)`.

3. **Apply runtime** (`studio/src/overlay/applyRuntime.ts`, dependency-free,
   runs in preview AND export) —
   `applyTweaks(root: Element, set: TweakSet): ApplyReport` — for each tweak:
   resolve anchor; on hit apply by kind (text → set `textContent`; style → set
   inline style props; hidden → `style.display = "none"`); on miss/ambiguous,
   record in the report (never throw). `ApplyReport = { applied: string[];
   unresolved: string[]; ambiguous: string[] }`. Each tweak wrapped in
   try/catch — one bad tweak never breaks the render. Re-runs on DOM mutation
   (a `MutationObserver` on the frame root, debounced) so a re-render re-applies.
   A corrupt/missing set → applies nothing, frame renders clean.

4. **Authoring runtime** (Studio, in the inspector/canvas layer) — Explore mode:
   reuse the existing canvas picker to select a node; instead of resolving to
   source, call `computeAnchor` and open a tweak control. Controls reuse the
   existing restyle panel + inline text edit, repointed to write an overlay
   tweak (not source). Emits the tweak to the sidecar via the API and lets the
   apply runtime reflect it.

5. **Sidecar API + storage** (`studio/server/middleware/tweaks.ts`,
   `studio/server/tweaks.ts`) —
   - `GET /api/tweaks/:slug?frame=<frameSlug>` → the `TweakSet` (or
     `{version:1,tweaks:[]}` when absent).
   - `PUT /api/tweaks/:slug?frame=<frameSlug>` body `TweakSet` → write
     `frames/<frameSlug>/tweaks.json` (reparse-safe JSON; closed-world slug/frame
     validation via the existing `requireSlug`/frame-dir guards).
   - Pure `readTweakSet`/`writeTweakSet` over `frameDir(slug, frameSlug)`.

6. **Preview injection** — the existing frame-mount plugin injects the apply
   runtime + a small bootstrap that fetches the sidecar and calls `applyTweaks`
   on the frame root, then arms the `MutationObserver`.

7. **Export/share bundling** — the share/export bundler includes the apply
   runtime script and copies `tweaks.json` into the bundle, with the same
   bootstrap, so the shared prototype self-applies tweaks with no Studio.

8. **Tweak list UI** (Studio panel) — shows the N tweaks for the frame, each with
   a human label ("text → …", "background → …", "hidden"), a discard control,
   and a **stale flag** when the last `ApplyReport` marked its anchor
   unresolved/ambiguous ("couldn't re-apply — element changed").

9. **Commit** (in v1; trigger UI TBD) — `POST /api/tweaks/:slug/commit?frame=…`
   → an agent turn seeded with the frame `index.tsx` + the `TweakSet`:
   "apply these visual tweaks to the source as clean code; each tweak names a
   rendered element by an anchor path + the change; preserve everything else."
   On success → clear the sidecar (code is now the truth). The TRIGGER (a share-
   menu item, a button, etc.) is decided in a later, small follow-up; the
   endpoint + agent prompt are v1 so the mechanism is complete.

## Data flow — recolor a baked-in chat bubble (the ex-impossible case)

1. Explore mode on → click a rendered message bubble inside `<ComputerScene/>`.
2. Authoring runtime: `computeAnchor` → e.g.
   `main>div:nth-of-type(2)>ul>li:nth-of-type(3)>div[role="article"]`.
3. Restyle panel → background color → tweak
   `{id, anchor, kind:"style", payload:{style:{backgroundColor:"var(--…)"}}}`
   → `PUT /api/tweaks/computer-chat?frame=01-computer`.
4. Apply runtime re-runs → resolves the anchor → sets inline style → bubble
   recolors instantly. No reload, no LLM, no source touched.
5. Reload → bootstrap fetches the sidecar → bubble still recolored.
6. Share → bundler ships the apply runtime + tweaks.json → shared prototype shows
   the recolored bubble.
7. (Later, optional) Commit → agent writes the color into the real source →
   sidecar cleared.

## Error handling

- **Stale anchor (structure changed):** `resolveAnchor` returns null → tweak
  skipped, render unaffected, tweak flagged in the list. No auto-drop, no fuzzy
  match, no crash.
- **Ambiguous anchor:** apply to the first match, flag low-confidence. The
  text-fingerprint discriminator makes this rare.
- **One malformed tweak:** per-tweak try/catch — others still apply.
- **Missing/corrupt sidecar:** treated as empty set → frame renders clean.
- **Commit agent failure:** sidecar untouched (tweaks remain as overlay); the
  frame still renders tweaked via the runtime. Graceful degrade to today.
- **Export without tweaks:** absent sidecar → bundler ships none → un-tweaked
  bundle (correct).

## Testing

- **Anchor (the make-or-break unit):** `computeAnchor` is stable across a
  re-render with identical structure; `resolveAnchor` round-trips back to the
  same node; a structural change yields `el:null` (unresolved, NOT a wrong
  node); a duplicated subtree yields `ambiguous:true`. Discriminator priority
  (data-attr > role > text-fingerprint) exercised.
- **Apply runtime:** a `TweakSet` + a DOM → text/style/hidden applied correctly;
  one malformed tweak doesn't break the others; missing/corrupt set → clean
  render + empty report; unresolved/ambiguous recorded in the report.
- **Tweak model:** `addOrReplace` (one per anchor+kind; style merge), `remove`,
  `clear` — pure, exact.
- **Sidecar API:** GET absent → empty set; PUT → readable JSON at the frame dir;
  closed-world slug/frame rejection.
- **Authoring round-trip:** click → anchor → PUT → apply → DOM reflects; discard
  → removed from set + render.
- **Export carries tweaks:** the built/shared bundle includes the apply runtime +
  tweaks.json and renders tweaked.
- **Commit:** the endpoint sends frame source + tweak set to a (mocked) agent;
  on ok, sidecar cleared; on failure, sidecar intact.
- **Manual gate (HUMAN):** on the ComputerScene frame — click a baked-in chat
  message → edit its text; recolor a bubble; hide a section. All instant, no
  LLM. Reload → still applied. Share → still applied. The exact thing that was
  "useless" now just works. Stale flag appears if the frame is regenerated with
  a different structure.

## Risks / honest limitations

- **Anchor durability is the core risk.** Resilient to reload/re-render/share;
  fragile to structural regeneration (prompt "redo the layout" → tree changes →
  some anchors unresolve). Mitigation: skip + flag, never silently wrong. This
  is the honest ceiling of an overlay-by-structure approach, and it's acceptable
  because Explore is for tweaking a prototype you're keeping, not for surviving a
  rebuild.
- **Move/reorder is out of v1.** Text/style/show-hide are node-local and express
  cleanly as an overlay; layout moves need a richer model. Deferred.
- **Commit fidelity** (overlay → clean code) is best-effort, LLM-bound — but it's
  optional, batched, off the hot path, and failure degrades to "tweaks stay as
  overlay." Far safer than the per-click source mapping that failed before.
- **Inline styles win specificity** during Explore; that's intended (a tweak must
  override the composite). Commit replaces them with proper code.
- **Verified by tests + reasoning** until the manual gate; given the history on
  this surface, the gate is mandatory before "done."

## Out of scope

- Move / reorder / freeform drag.
- The Commit *trigger UI* (share-menu item vs button vs other) — separate small
  follow-up; the commit endpoint + agent prompt ARE in v1.
- Re-anchoring tweaks across a structural regeneration (fuzzy match) — rejected
  as silently-dangerous.
- Editing arcade-gen primitive props / the props panel (the reverted approach).
