# Lift Manifest — post-merge follow-ups

Findings surfaced by the holistic review of the `feat/lift-manifest` branch but
deferred to follow-up PRs. Each is small enough to live on its own; none block
the three-lift validation loop in spec §10.

## Ordered by priority

### 1. Debounce concurrent `emitLiftForFrame` calls

**Status:** known-bug, self-healing  
**Files:** `studio/server/plugins/liftEmitPlugin.ts`

Two chokidar events on the same frame in quick succession (editor save +
formatter rewrite, which happens constantly during claude-subprocess writes)
interleave:

    emit A: reads source v1
    emit B: reads source v2
    emit B: writes LIFT (v2)     ← fresh
    emit A: writes LIFT (v1)     ← stale — wins

Converges on the next save. First bug report about "manifest shows old stuff"
traces here.

**Fix sketch:** per-`<slug>/<frame>` mutex map keyed by `${slug}/${frame}`, or
a trailing-edge debounce (e.g. 150ms) per frame. ~20 LOC either way. Add a
test that fires two `emitLiftForFrame` calls concurrently and asserts the
second one's output wins.

### 2. ENOENT tolerance around the manifest writes

**Status:** noisy warning, not a correctness bug  
**Files:** `studio/server/plugins/liftEmitPlugin.ts:54-56`

`projectWatchPlugin` runs `reconcileFrames` on every `.tsx` change, which can
delete a frame's directory right around the time the lift plugin is mid-write.
Today the two `fs.writeFile` calls can throw ENOENT; the outer watcher
`try/catch` logs a warning but the user sees a spurious error in the console.

**Fix sketch:** wrap the two `writeFile` calls in a helper that swallows
`ENOENT` silently (the frame is gone; the manifest doesn't matter). Mirror the
pattern in `readFile` at line 39.

### 3. ~~Reword the Button row's notes column~~ — partially resolved by 0.9.0

**Status:** partially superseded by the XML format shift in 0.9.0.  
**Files:** `studio/src/lift/render.ts`, `studio/src/lift/mappings/primitives.ts`

The original complaint was a six-clause semicolon chain in a Markdown table
cell. With the XML format (0.9.0), `prop_delta` entries are distinct child
elements, so the scan-friendliness problem is gone for free.

The remaining micro-cleanup is the identity-mapping noise: the Button entry's
`variant` value map still renders as `primary->primary, secondary->secondary,
tertiary->tertiary, destructive->destructive`. Omit value maps where every
key equals its value — they carry no translation information.

### 4. Disambiguate `VistaRow → Row`

**Status:** misleading name in common case  
**Files:** `studio/src/lift/mappings/composites.ts`

The inventory row says `Row` from `raw-design-system`. An engineer grepping
`devrev-web` for `Row` will drown in thousands of matches (it's a common
variable name *and* a common export). Options:

- Add `slotNotes` that explicitly name the raw-design-system Row's import
  shape (e.g. `import { Row } from '@devrev-web/design-system/shared/raw-design-system'`)
  and note typical call sites.
- Reconsider the mapping entirely — per the original research, production
  tables build rows per-feature from cell components; there may be no single
  "Row" component that VistaRow maps cleanly onto.

### 5. ~~Tokens section: drop when empty~~ — still open in 0.9.0

**Status:** filler content  
**Files:** `studio/src/lift/render.ts`

0.9.0 kept the `<tokens alignment="aligned">…</tokens>` element with the
same single-sentence "nothing to do" body. Still filler; still true that
omitting the element in the steady-state case would tighten the artifact.
Revisit when token drift introduces real exceptions that need listing.

### 6. Concurrency cap on cold-start emissions

**Status:** fine today, may matter at scale  
**Files:** `studio/server/plugins/liftEmitPlugin.ts:70-92`

`emitForExistingFrames()` walks projects sequentially. At ~3ms per frame,
50 frames = 150ms (invisible). 500 frames would be 1.5s. Still fire-and-forget
so boot isn't blocked, but beta testers with large project collections might
notice a delay before manifests show up. Cap at ~10 concurrent with a simple
worker pool when it matters.

### 7. Harden `ShareModal` copy-twice UX

**Status:** cosmetic  
**Files:** `studio/src/components/shell/ShareModal.tsx`

If the user clicks "Copy Lift Manifest" twice in quick succession, click 1's
2-second timeout fires after click 2's success and flips the button back from
"Copied!" to "Copy Lift Manifest" early. Store the timeout handle and clear
it in `handleCopyManifest` before setting a new one.

### 8. Verify remaining `@devrev-web/*` mapping specifiers

**Status:** precaution  
**Files:** `studio/src/lift/mappings/composites.ts`

Merge-gate review caught `PROD_LISTVIEW`. The other specifiers
(`@devrev-web/design-system/shared/raw-design-system`, `.../shared/pages`,
`.../shared/settings`) were spot-checked during the fix and grep confirmed
real consumers use them. But a more systematic sweep — for every mapping
entry, grep the real devrev-web tree for at least one consumer using the
exact specifier — would catch any other guess before the first real lift
attempt.

---

## Not follow-ups

Three items in the review turned out to be non-issues and are not included
above; recording the dispositions so they don't get reopened:

- **`parseFrameTouched` depth handling** — already correct. `parts.length < 4`
  plus `parts[3] !== "index.tsx"` rejects both shallow and deep paths.
- **Path traversal in `liftMiddleware`** — already safe. Two layers of slug
  validation (URL regex + `requireSlug` inside `frameDir`).
- **`ignoreInitial: true` + cold-start walk duplicate emissions** — possible
  but produces byte-identical output, no observable bug.
