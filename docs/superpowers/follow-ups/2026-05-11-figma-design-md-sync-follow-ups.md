# Figma Design-System Sync — Follow-ups

**Parent spec:** [2026-05-11-figma-design-md-sync-design.md](../specs/2026-05-11-figma-design-md-sync-design.md)
**Parent plan:** [2026-05-11-figma-design-md-sync.md](../plans/2026-05-11-figma-design-md-sync.md)
**Merged as:** 0.15.0 (branch `feat/studio/figma-design-md-sync`)
**Source of this list:** adversarial review at end of `ce-adversarial-reviewer` pass before 0.15.0 ship.

Follow-ups below are grouped by severity. Fixes landed in 0.15.0 are noted and the rest are open.

---

## Fixed in 0.15.0

### F1 — CLAUDE.md overwrite would stomp user edits
**Status:** ✅ fixed in `refreshStaleClaudeMd` — prior contents are now written to `CLAUDE.md.bak` before the template rewrite. Single rolling backup; last refresh wins. Tests at `studio/__tests__/server/projects.test.ts` pin the invariant.

### F2 — Empty allow-list bypassed color-provenance check
**Status:** ✅ fixed in `systemSynth.ts:postProcess`. The `allowedColorValues.size > 0 &&` guard was removed; when the Figma file has no published paint styles or color variables, every LLM-proposed hex is dropped with a `dropped color "<name>" with unsourced value "<hex>"` warning, and the Colors section in DESIGN.md renders empty. Identity still speaks (grounded in PNGs). Regression test at `systemSynth.test.ts` covers the empty-sources path.

---

## High — address before 0.16

### H1 — `pickSampleFrames` ignores SECTION- and GROUP-wrapped frames
**File:** [studio/server/figma/systemSources.ts:78](../../studio/server/figma/systemSources.ts#L78)

`pickSampleFrames` walks `canvas.children` and keeps only `type === 'FRAME'`. Figma files organized with SECTION wrappers (common for design-doc files, dashboards, or library files with cover pages) silently return zero sample frames → empty Identity → defeatist DESIGN.md.

Compounded by `--depth 2` in `getFile`: depth 2 stops at the SECTION node and never loads its FRAME children. The recursion has nothing to find.

**Fix sketch:**
1. In `pickSampleFrames`, recurse into `SECTION` and `GROUP` nodes, collecting FRAMEs up to N levels deep (N=3 is probably enough).
2. In `figmaSystemIngest.ts`, bump `--depth` to 3, or probe: depth 2 first, re-fetch at depth 3 if frame count is 0. Bounded by `MAX_SAMPLE_FRAMES=8` so payload stays tractable.

**Regression test before fix:** add a fixture with a SECTION wrapping FRAMEs, assert `pickSampleFrames` returns them.

---

## Medium — address within 0.16–0.17

### M1 — `getCached` bypasses TTL and LRU refresh
**File:** [studio/server/figmaSystemIngest.ts:102](../../studio/server/figmaSystemIngest.ts#L102)

Private `cacheGet` expires entries past their TTL and refreshes LRU position. Public `getCached` does a raw `cache.get` with neither. No current caller is affected (the factory consumers only use `ingest()`), but a future "Resync" button or status endpoint would silently serve arbitrarily stale data.

**Fix:** delegate `getCached` to `cacheGet`. One-line.

### M2 — Cache returns shared references across cache hits
**File:** [studio/server/figmaSystemIngest.ts:92](../../studio/server/figmaSystemIngest.ts#L92)

`return { ok: true, ...cached.value }` spreads the top level but leaves nested `sections`/`source`/`diagnostics` as shared references. No current consumer mutates, but invariant-by-convention. A single careless `.sort()` on `out.sections.components` would leak across projects sharing a fileKey.

**Fix:** `structuredClone(cached.value)` before returning. Small perf cost, but prevents a class of silent bugs.

### M3 — Seeder `.tmp` write race under turn-registry bypass
**File:** [studio/server/middleware/chat.ts:359](../../studio/server/middleware/chat.ts#L359)

Two concurrent seeders on the same slug both write to `${targetPath}.tmp` (fixed name). Production path is protected by `turnRegistry`'s 409 guard, but a direct POST to `/api/chat` or any future "run seeder outside a turn" path reaches this race. Interleaved writes produce possibly-spliced DESIGN.md; `.tmp` does not leak (second rename ENOENTs into the catch).

**Fix:** use a per-invocation tmp suffix: `${targetPath}.${process.pid}.${Date.now()}.tmp`. Orphans from crashes can be swept lazily or ignored.

---

## Low — file and triage when convenient

### L1 — stdin-write race with spawn error event
**File:** [studio/server/figma/systemSynth.ts:213](../../studio/server/figma/systemSynth.ts#L213)

Synchronous `proc.stdin.write(prompt); proc.stdin.end()` after spawn can race with an async 'error' event (ENOENT etc.). Write to closed pipe emits a stream error; we don't attach an error listener, so Node may crash or warn. Low repro probability; only hits when the claude binary is missing or spawn fails.

**Fix:** add `proc.stdin.on('error', () => {})` before the write, OR wait for `proc.on('spawn', () => proc.stdin.end(prompt))`.

### L2 — `scannedAt` shared across projects hitting the same fileKey cache
**File:** [studio/server/figmaSystemIngest.ts:72](../../studio/server/figmaSystemIngest.ts#L72)

Project A seeds at T0 → cache stores `scannedAt = T0`. Project B (different slug, same fileKey) seeds at T+30min → cache hit → DESIGN.md for project B is stamped T0, 30 minutes before it was written. Not a correctness bug for generation but misleading user-facing artifact.

**Fix:** overwrite `scannedAt` to `now()` when returning from the cache, or rename the field to `firstScannedAt` in the render template.

### L3 — Fragile `not.toMatch(/Read/)` assertion
**File:** [studio/__tests__/server/figma/systemSynth.test.ts:193](../../studio/__tests__/server/figma/systemSynth.test.ts#L193)

The `no-samples → no Read` assertion catches the literal substring anywhere. Any future prompt edit containing "Read" (e.g. "Never re-read the digest") breaks this test for reasons unrelated to the image contract. The sibling `not.toMatch(/Sample frames are rendered as PNGs/)` is sufficient.

**Fix:** drop the `/Read/` assertion, OR tighten to `/should Read/i` targeting the actual image instruction phrasing.

### L4 — `--depth 2` hardcode is spec drift
**File:** [studio/server/figmaSystemIngest.ts:144](../../studio/server/figmaSystemIngest.ts#L144)

Spec says `getFile` returns the full document tree. Implementation caps at `--depth 2` because the API rejects full-tree requests. Commit `29d6581` captures the reason but the spec wasn't amended. Future readers see the divergence with no guidance. Doubly painful because of compound with H1 (SECTION wrappers).

**Fix:** update the spec's `figmaSystemIngest.ts` description to note the depth bound and its rationale, or add a `SPEC-DRIFT` note block in the file.

### L5 — `RenderSource.fileName` is emitted into the type but never used in the rendered template
**File:** [studio/server/figma/systemRender.ts:6](../../studio/server/figma/systemRender.ts#L6)

`RenderSource` accepts `fileName?: string` but `renderDesignMd` never writes it into the markdown. Either forgotten feature (include in the header comment) or dead field.

**Fix:** either add `fileName` to the rendered comment (useful: beta testers can tell which Figma file a DESIGN.md was derived from) or remove the field.

---

## Testing gaps

### T1 — No sentinel test for `@DESIGN.md` import pickup
**Where it lives today:** in the spec as a manual QA step (section "Testing / Not tested automatically" in the spec doc).

**Risk:** if a future Claude CLI flag change breaks how `--bare` resolves imports, the seeder still writes DESIGN.md, Studio narrates "Synced", but the subprocess never reads it. No failing test — only slow Identity-quality drift a beta tester might or might not report.

**Fix sketch:** an integration test that spawns a real `claude --print` in a tmp project with a `CLAUDE.md` importing a `DESIGN.md` containing a sentinel string. Assert the process output references the sentinel. Slow (real network via Bedrock) but catches a class of silent regression nothing else covers. Gate behind `ARCADE_STUDIO_LIVE_CLAUDE_TEST=1`.

### T2 — No test for concurrent-seeder `.tmp` race
See M3. The current race test (`chat-figma-seeder-race.test.ts`) verifies the happy path and the atomic-rename failure path, but does not inject an `fs.writeFile` delay on one of two concurrent seeders to exercise the interleaved-write path.

### T3 — No test for `pickSampleFrames` recursion through SECTION wrappers
See H1. The minimal fixture has direct-CANVAS frames only. Adding a SECTION-wrapped fixture would fail today (zero samples), which is exactly the regression this should lock down.

### T4 — No test for Identity-quality on "neither published styles nor sample frames" files
Theoretical worst case: a Figma file with neither published styles/variables nor any frame ≥ 400×400. Both grounding axes are bare, so `buildPrompt` falls through to "no data" and Identity honestly collapses. Probably acceptable — but a test would pin the contract.

---

## Process notes

- Adversarial review was the finding-multiplier here. Spec-compliance + code-quality reviewers during task-by-task execution each approved what they saw; the axis they couldn't see is "what happens when multiple file states combine in unexpected ways." Explicitly running an adversarial pass at end-of-branch is worth keeping as a habit.
- Three real integration bugs surfaced only in live QA (no `--attach` flag, `get-file` too large, `--add-dir` argparser collision). All were pre-release and fixed in flight. The unit-test suite had no way to catch any of them because they were CLI contract assumptions, not logic bugs. Implication: for features that shell out to third-party CLIs, budget explicit pre-merge CLI smoke tests.
