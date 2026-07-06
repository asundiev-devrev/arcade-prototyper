# Figma import v2 — deterministic-first routing (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route pure faithful-reproduction Figma prompts ("implement this precisely: <URL>") to Studio's deterministic kit-emit engine instead of the LLM reconstructor, so the copy case comes out pixel-faithful.

**Architecture:** One behavioural change in the router (`shouldGenerateFromFigma`): stop treating hi-fi wording as a reason to wake the LLM. Keep interaction + build intent on the LLM. Widen the build-intent verb set with destructive/substitution edits so mixed "copy-but-tweak" prompts still reach the LLM instead of silently dropping the tweak. `detectHiFiIntent` survives untouched as the LLM's *directive* (inside `runClaudeBranch`); we only remove it from *routing*.

**Tech Stack:** TypeScript, Vitest (`@vitest-environment node`), Vite middleware. Package manager is **pnpm**. Tests run via `pnpm run studio:test <path>` from the repo root.

## Global Constraints

- Package manager is **pnpm** — never `npm`/`yarn` (breaks the lockfile).
- Run tests from the **repo root**, not `studio/`: `pnpm run studio:test <path>`. `studio/` is not a pnpm workspace member.
- Commits use Conventional Commits, scope `studio/figma`: e.g. `fix(studio/figma): ...`.
- Never `git add -A`/`git add .` — stage explicit paths only.
- `detectHiFiIntent` MUST remain exported and functional — it is still used by `shouldUseHiFi` and inside `runClaudeBranch` (`chat.ts`) for the faithfulness directive. This plan removes it ONLY from `shouldGenerateFromFigma`.
- Do NOT reintroduce the LLM as a fallback for the deterministic path — that reopens the reconstruct-from-summary failure (spec Risk 4).
- Spec: `docs/superpowers/specs/2026-07-06-figma-import-v2-deterministic-first-design.md`.

---

## File Structure

- `studio/server/figma/generationIntent.ts` — the router gate. Two changes: drop the `detectHiFiIntent` clause from `shouldGenerateFromFigma` (+ remove its now-unused import); add edit verbs to `BUILD_INTENT_PATTERNS`.
- `studio/__tests__/server/figma/generationIntent.test.ts` — unit tests for the gate. Flip the pure-hi-fi expectation; add edit-verb cases.
- `studio/__tests__/server/middleware/chat-figma-context.test.ts` — end-to-end routing contract through the middleware. Migrate the directive tests to a hi-fi+build prompt (so they keep guarding the directive in its correct domain) and add a new "pure hi-fi routes deterministic" test.

No new files. No changes to `fidelityDirective.ts`, `chat.ts`, or `kitEmitBranch.ts`.

---

## Task 1: Drop hi-fi from the routing gate

**Files:**
- Modify: `studio/server/figma/generationIntent.ts` (the `shouldGenerateFromFigma` body + the `detectHiFiIntent` import + the module docstring reference)
- Test: `studio/__tests__/server/figma/generationIntent.test.ts`
- Test: `studio/__tests__/server/middleware/chat-figma-context.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `shouldGenerateFromFigma(prompt: string): boolean` now returns `detectInteractionIntent(prompt) || detectBuildIntent(prompt)` (hi-fi no longer routes). `detectHiFiIntent` remains exported from `fidelityDirective.ts` and used elsewhere — do not touch it.

- [ ] **Step 1: Migrate the two directive tests to a hi-fi+build prompt (keep them guarding the directive)**

In `studio/__tests__/server/middleware/chat-figma-context.test.ts`, the block `describe("hi-fi directive survives a Figma digest miss")` currently posts a PURE hi-fi prompt (`"Implement this precisely <url>"`) and asserts the Claude branch ran. After this task a pure hi-fi prompt routes to kit-emit, so these would false-break. Add a build verb so they keep reaching the LLM (which is where the directive lives), preserving the exact guarantee (the hi-fi directive is appended on a digest miss). Replace the two `it(...)` bodies:

```ts
  it("appends <high_fidelity_mode> even when no digest/PNG is available", async () => {
    // Ingest is mocked to miss (above). A prompt that reaches the LLM (build
    // intent) AND carries hi-fi wording must STILL carry the directive on a
    // digest miss — the defect-A regression guard. NB: pure-hi-fi prompts now
    // route to kit-emit (see the separate routing test below); the directive
    // guarantee applies to prompts that legitimately reach the generator.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const prompt =
      "Implement this precisely and make the input functional " +
      "https://www.figma.com/design/k/x?node-id=1-2";
    const res = await post(p.slug, prompt);
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    const sent = fs.readFileSync(process.env.ARCADE_TEST_PROMPT_OUT!, "utf8");
    expect(sent).toContain("<high_fidelity_mode>");
  });

  it("emits the precise-mode narration on a hi-fi turn (the wider-budget branch)", async () => {
    // Proves the hi-fi BRANCH is taken end-to-end for a prompt that reaches the
    // generator. Budget VALUE is pinned separately in digest-race-budget.test.ts.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const stream = await (async () => {
      await post(
        p.slug,
        "Implement this precisely and make the input functional " +
          "https://www.figma.com/design/k/x?node-id=1-2",
      );
      return drainStream(p.slug);
    })();
    expect(stream).toContain("precise mode");
  });
```

- [ ] **Step 2: Add the new routing test — pure hi-fi goes deterministic**

In the SAME file, inside `describe("/api/chat Figma-URL routing (kit-emit branch)")`, add a test (mirrors the existing bare-import test at line 98) that pins the new contract:

```ts
  it("routes a PURE hi-fi prompt (no build/interaction verb) to the kit-emit branch", async () => {
    // "implement precisely" with a URL and no build/interaction instruction is a
    // faithful-reproduction ask — it must take the deterministic engine, not the
    // LLM reconstructor. This is the core figma-import-v2 routing flip.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const res = await post(
      p.slug,
      "Implement this precisely https://www.figma.com/design/k/x?node-id=1-2",
    );
    expect(res.status).toBe(202);
    await drainStream(p.slug);

    expect(kitEmitSpy).toHaveBeenCalledTimes(1);
    expect(kitEmitSpy.mock.calls[0][0].nodeId).toBe("1:2");
    // Claude never ran: the fake bin writes argv to ARCADE_TEST_PROMPT_OUT.
    expect(fs.existsSync(process.env.ARCADE_TEST_PROMPT_OUT!)).toBe(false);
  });
```

- [ ] **Step 3: Update the eject test's stale premise comment**

In the same file, `describe("eject-to-source on a compose-base turn")`, the test `"does NOT eject on a plain precise prompt with no named composite"` (posts `"Implement this precisely <url>"`) still passes — a pure hi-fi prompt now routes to kit-emit, which does not eject — but its comment implies it reached the LLM. Update only the comment for honesty; leave the assertion:

```ts
  it("does NOT eject on a plain precise prompt with no named composite", async () => {
    // A pure precise prompt now routes to the deterministic kit-emit branch,
    // which never ejects. (A build-intent prompt naming a composite ejects —
    // see the test above.) Either way, no .eject dir here.
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    await post(p.slug, "Implement this precisely https://www.figma.com/design/k/x?node-id=1-2");
    await drainStream(p.slug);
    const ejectDir = path.join(process.env.ARCADE_STUDIO_ROOT!, "projects", p.slug, ".eject");
    expect(fs.existsSync(ejectDir)).toBe(false);
  });
```

- [ ] **Step 4: Flip the unit-test expectations for pure hi-fi**

In `studio/__tests__/server/figma/generationIntent.test.ts`, replace the block at lines 25-28 (title `"fires on hi-fi intent alone…"`) with its inverse, and rename the title:

```ts
  it("does NOT fire on hi-fi intent alone — pure precise/pixel-perfect routes deterministic", () => {
    expect(shouldGenerateFromFigma("implement this precisely")).toBe(false);
    expect(shouldGenerateFromFigma("pixel-perfect build of this frame")).toBe(false);
  });
```

Leave the motivating multi-instruction test (lines 11-23) unchanged — it carries "functional"/"theme"/"as a base" build intent and must still return `true`.

- [ ] **Step 5: Run the tests to verify they fail against current source**

Run: `pnpm run studio:test __tests__/server/figma/generationIntent.test.ts __tests__/server/middleware/chat-figma-context.test.ts`
Expected: FAIL — `generationIntent` "does NOT fire on hi-fi intent alone" fails (source still returns `true`), and the new middleware test "routes a PURE hi-fi prompt … to the kit-emit branch" fails (`kitEmitSpy` not called; claude ran). The two migrated directive tests and the eject test should PASS (they route to the LLM / kit-emit under current source too).

- [ ] **Step 6: Change the source — remove hi-fi from routing**

In `studio/server/figma/generationIntent.ts`:

First, delete the now-unused import (line 30):

```ts
import { detectHiFiIntent } from "./fidelityDirective";
```

Then change `shouldGenerateFromFigma` (lines 119-126) body from:

```ts
export function shouldGenerateFromFigma(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  return (
    detectHiFiIntent(prompt) ||
    detectInteractionIntent(prompt) ||
    detectBuildIntent(prompt)
  );
}
```

to:

```ts
export function shouldGenerateFromFigma(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  // Hi-fi wording ("precisely", "pixel-perfect") is deliberately NOT a routing
  // trigger: a faithful-reproduction ask belongs on the deterministic kit-emit
  // engine (fidelity by construction), not the LLM reconstructor. Only intent
  // the importer cannot honour — interactivity or a build/edit instruction —
  // routes to the generator. detectHiFiIntent still governs the LLM's directive
  // inside runClaudeBranch; it just no longer decides the engine.
  return detectInteractionIntent(prompt) || detectBuildIntent(prompt);
}
```

Also update the module docstring line 28 (`"same shape as detectHiFiIntent / detectInteractionIntent, which this composes with."`) to drop the `detectHiFiIntent` reference, e.g.:

```ts
 * Pure, keyword-based, and exported for unit testing — same shape as
 * detectInteractionIntent, which this composes with.
```

Update the JSDoc on `shouldGenerateFromFigma` (lines 107-118) so the "Fires on ANY of: hi-fi intent …" bullet no longer lists hi-fi:

```ts
/**
 * Decide whether a Figma-URL prompt should go to the LLM generator (design as
 * reference) instead of the deterministic importer.
 *
 * Fires on ANY of:
 *  - interaction intent ("click opens a modal", "on hover show …"),
 *  - build intent (modify a composite, make it functional, apply a theme,
 *    remove/swap/replace an element).
 *
 * A faithful-reproduction ask (bare import, or "implement precisely" with no
 * build/interaction instruction) matches none of these and stays on the fast
 * deterministic path.
 */
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/figma/generationIntent.test.ts __tests__/server/middleware/chat-figma-context.test.ts`
Expected: PASS (all tests in both files green).

- [ ] **Step 8: Commit**

```bash
git add studio/server/figma/generationIntent.ts \
        studio/__tests__/server/figma/generationIntent.test.ts \
        studio/__tests__/server/middleware/chat-figma-context.test.ts
git commit -m "fix(studio/figma): route faithful-reproduction prompts to the deterministic engine

Drop hi-fi wording ('precisely'/'pixel-perfect') as a routing trigger in
shouldGenerateFromFigma. A faithful-reproduction ask now takes the deterministic
kit-emit engine (fidelity by construction) instead of the LLM reconstructor that
produced the black-blob nav render. detectHiFiIntent stays as the LLM's directive
inside runClaudeBranch; only routing changes. Migrated the digest-miss directive
tests to a hi-fi+build prompt (their real domain) and added a pure-hi-fi->kit-emit
routing test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Widen build-intent with destructive/substitution edit verbs

**Files:**
- Modify: `studio/server/figma/generationIntent.ts` (`BUILD_INTENT_PATTERNS` array, lines 42-54)
- Test: `studio/__tests__/server/figma/generationIntent.test.ts`

**Interfaces:**
- Consumes: `detectBuildIntent(prompt: string): boolean` and `shouldGenerateFromFigma` from Task 1.
- Produces: `detectBuildIntent` now also returns `true` for imperative remove/delete/swap/replace/rename-of-an-object edits and imperative "make … dark/light". No signature change.

**Why:** Task 1 removed hi-fi from routing. A prompt like "recreate this exactly, **remove** the search bar" now routes deterministic and the edit is silently dropped, because those verbs aren't in `BUILD_INTENT_PATTERNS`. Widen the set so copy-but-tweak asks reach the LLM. Keep it tight — an over-broad set would re-route pure copies to the LLM, the exact defect Task 1 removes (spec Risk 2).

**Tightness is load-bearing (adversarial finding).** A first draft used bare-verb
alternations (`\b(remove|delete|drop|swap|replace|rename)\b` and a greedy
`make[^.]*dark`). Ground-truth testing showed those misroute real faithful copies
to the LLM: "keep the drop **shadow**", quoted labels ("the CTA says 'Swap plan'"),
purpose clauses ("this will **replace** the current page"), and "make **sure** the
dark header matches". The patterns in Step 3 are the tightened forms that pass the
full false-positive/true-positive corpus (Step 1 tests). **Accepted residual
false-negatives** (dark/light re-theme phrased without "make": "convert to dark
mode", "in dark mode") route deterministic and drop the recolor — the kit-emit
trailer's "tell me what to change next" is the backstop. Widening to catch them
reintroduces the Tier-2 false positives, so we deliberately don't.

- [ ] **Step 1: Write the failing tests**

In `studio/__tests__/server/figma/generationIntent.test.ts`, add inside `describe("shouldGenerateFromFigma", …)`. These positive/negative cases are the exact set an adversarial review used to tighten the patterns — keep them ALL, they pin the tight boundary:

```ts
  it("fires on destructive/substitution edit verbs (importer can't perform these)", () => {
    expect(detectBuildIntent("remove the search bar")).toBe(true);
    expect(detectBuildIntent("delete the top nav")).toBe(true);
    expect(detectBuildIntent("swap the logo for ours")).toBe(true);
    expect(detectBuildIntent("replace the avatars with initials")).toBe(true);
    expect(detectBuildIntent("rename the tabs")).toBe(true);
    expect(detectBuildIntent("make the sidebar dark")).toBe(true);
    expect(detectBuildIntent("replace the header with a banner")).toBe(true);
  });

  it("routes a copy-but-tweak prompt (hi-fi + edit verb) to the generator", () => {
    // The gap Task 1 opened: hi-fi wording no longer routes, so the edit verb
    // must carry it to the LLM or the tweak is silently dropped.
    expect(shouldGenerateFromFigma("recreate this exactly, remove the search bar")).toBe(true);
    expect(shouldGenerateFromFigma("implement precisely but make the sidebar dark")).toBe(true);
  });

  it("does NOT misroute faithful-copy prompts that merely CONTAIN an edit word", () => {
    // Every one of these is a pure photocopy — must stay deterministic. The
    // words appear as style descriptions, quoted UI labels, purpose clauses, or
    // "make sure/match" hedges, not as edit instructions. (Adversarial FP set.)
    const copies = [
      "keep the drop shadow on the card",              // "drop" NOT an edit verb
      "copy this exactly including the drop-shadow",   // drop-shadow
      "make sure the dark header matches the figma",   // make SURE = ensure
      "copy this — make it match the light mockup",    // make…match = comparison
      "the button label reads 'Delete account'",       // quoted label
      "the modal is titled 'Rename workspace'",        // quoted label
      "this design will replace the current home page",// purpose, not instruction
      "the design is meant to replace the settings page",
      "implement the dark variant precisely",          // describes what to copy
      "a delete button in the toolbar",                // noun, not verb
    ];
    for (const p of copies) expect(shouldGenerateFromFigma(p), p).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm run studio:test __tests__/server/figma/generationIntent.test.ts`
Expected: FAIL — the "destructive/substitution edit verbs" and "copy-but-tweak" cases return `false` (verbs not yet matched). The "faithful copy … dark design" case already passes (nothing matches it yet).

- [ ] **Step 3: Add the patterns**

In `studio/server/figma/generationIntent.ts`, append to the `BUILD_INTENT_PATTERNS` array (after the theme patterns, before the closing `];` at line 54). These are the TIGHTENED forms verified against the adversarial false-positive set — do NOT simplify them back to bare-verb alternations (that misroutes "drop shadow", quoted labels, and "make sure … dark", reintroducing the reconstruct-from-summary failure Task 1 removes). Lookbehind is safe: tsconfig target is ES2022, Node 22:

```ts
  // Destructive / substitution edits: the deterministic importer can only
  // transcribe what the design contains — it cannot remove, swap, or rename a
  // part. Anchored to VERB + determiner + object so the bare word inside a
  // quoted label ("the CTA says 'Swap plan'") or a noun ("a delete button")
  // does NOT fire. The negative lookbehind rejects description-of-purpose
  // ("this design WILL replace the current page"). "drop" is deliberately
  // EXCLUDED — remove/delete cover the real edit, and "drop shadow" is the most
  // common faithful-copy phrase (this exact word over-blocked once before:
  // commit 4b1aa4c).
  /(?<!\b(?:will|would|to|can|could|should|may|might)\s)\b(?:remove|delete|swap|replace|rename)\s+(?:the|this|that|these|those|all|a|an|its|their)\b/i,
  // A per-element dark/light recolor, imperative ("make the sidebar dark").
  // Excludes "make sure/certain" (ensure, not transform) and "make … match …
  // light/dark" (a comparison to the reference, not a recolor). Bounded,
  // comma-free span so it can't bridge unrelated clauses.
  /\bmake\b(?!\s+(?:sure|certain))(?![^.,]*\bmatch)[^.,]{0,24}\b(?:dark|light)\b/i,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm run studio:test __tests__/server/figma/generationIntent.test.ts`
Expected: PASS (all cases green, including the "faithful copy … dark design" negative case).

- [ ] **Step 5: Commit**

```bash
git add studio/server/figma/generationIntent.ts \
        studio/__tests__/server/figma/generationIntent.test.ts
git commit -m "fix(studio/figma): treat remove/swap/rename/make-dark as build intent

After dropping hi-fi from routing, a 'copy but tweak' prompt (e.g. 'recreate this
exactly, remove the search bar') would route deterministic and silently drop the
edit. Widen BUILD_INTENT_PATTERNS with unambiguous destructive/substitution verbs
and imperative make-dark/light so these reach the LLM. Kept tight so a faithful
copy that merely describes a dark design stays on the deterministic path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Full-suite gate + live acceptance render

**Files:**
- No source changes. Verification only.

**Interfaces:**
- Consumes: the shipped routing from Tasks 1-2.
- Produces: evidence (screenshot) that the shipped path reaches the deterministic engine and renders faithfully.

- [ ] **Step 1: Run the full suite**

Run: `pnpm run studio:test`
Expected: PASS — full suite green. If any test outside the two files above fails, it is additional collateral not caught in planning: read it, determine whether it asserted the old hi-fi-routing contract, and fix it in the same spirit (migrate to hi-fi+build for directive coverage, or re-assert the new contract). Do NOT weaken an unrelated assertion to force green.

- [ ] **Step 2: Start Studio for a live render**

Run (from repo root, background):

```bash
ARCADE_STUDIO_OPEN_BROWSER=0 node_modules/.bin/vite --config studio/vite.config.ts --port 5557 &
```

Wait ~12s, then confirm it serves: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5557/` → `200`.

- [ ] **Step 3: Send the real acceptance prompt through the chat API**

The acceptance design is file `JztJjqt3i6uFwB6r4dfewz`, node `139-3839`. Post the exact failing prompt to a fresh project (or reuse `implement-this-design-precisely-2`):

```bash
curl -s -X POST http://localhost:5557/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"slug":"implement-this-design-precisely-2","prompt":"Implement this design precisely: https://www.figma.com/design/JztJjqt3i6uFwB6r4dfewz/Navigation--where-to-next?node-id=139-3839"}'
```

Then drain the stream: `curl -s http://localhost:5557/api/chat/stream/implement-this-design-precisely-2` and watch the server log.
Expected: the server log shows `[kitEmit] … kit instances` (deterministic engine ran), NOT a claude spawn. `figmanage` must be on PATH — prefix the vite command with `PATH="$PWD/node_modules/.bin:$PATH"` if `whoami` fails.

- [ ] **Step 4: Screenshot the rendered frame and compare to Figma**

Render `http://localhost:5557/api/frames/implement-this-design-precisely-2/<new-frame-slug>?mode=light` (frame slug is `NN-figma-139-3839`; check the project's `frames/` dir). Screenshot via Playwright. Export the Figma reference for the same node (`node_modules/.bin/figmanage export nodes JztJjqt3i6uFwB6r4dfewz 139-3839 --format png --scale 2 --json`, download the URL).

Pass criteria (spec Acceptance):
- Routed to the deterministic engine (Step 3 log).
- `Computer/Logo` renders faithfully (exported SVG), not a black blob or a substituted glyph.
- Sidebar + content geometry match the Figma layout; nothing off-screen.
- No hallucinated-import auto-repair turn in the chat history.

Known-acceptable (do NOT fail on these): sidebar as positioned divs (not `ComputerSidebar`); the "Today's Top Priorities" bullet list as narrow columns.

- [ ] **Step 5: Stop the server and record the result**

```bash
pkill -f "vite.*5557"
```

Note the acceptance outcome (pass/fail + screenshot path) in `.superpowers/sdd/progress.md` if that ledger is in use, or report it back for review. No commit needed unless a source fix was required in Step 1.

---

## Self-Review

**1. Spec coverage:**
- Drop hi-fi from routing gate → Task 1. ✓
- Widen `BUILD_INTENT_PATTERNS` (companion change / Risk 2 mitigation) → Task 2. ✓
- `detectHiFiIntent` stays as LLM directive (not deleted) → Global Constraints + Task 1 Step 6 (import removed only from `generationIntent.ts`; function untouched in `fidelityDirective.ts`). ✓
- Update `generationIntent.test.ts` (flip pure-hi-fi; add edit verbs) → Task 1 Step 4, Task 2 Step 1. ✓
- Rewrite `chat-figma-context.test.ts` directive block (own the collateral) → Task 1 Steps 1-3. ✓
- Full suite green (collateral enumerated, not denied) → Task 3 Step 1. ✓
- Live render + screenshot acceptance on node 139-3839 → Task 3 Steps 2-4. ✓
- Part B, template-tweak case, mapping growth, bullet-list fix → all marked Out in spec; correctly ABSENT from this plan. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows the actual code or exact command. ✓

**3. Type consistency:** `shouldGenerateFromFigma(prompt: string): boolean`, `detectBuildIntent(prompt: string): boolean`, `detectInteractionIntent`, `kitEmitSpy.mock.calls[0][0]` shape (`.fileKey`/`.nodeId`/`.slug`) all match the current source read during planning. No renamed symbols. ✓
