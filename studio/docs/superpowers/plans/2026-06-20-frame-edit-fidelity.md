# Frame Edit Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Arcade Studio honor explicit edit requests literally (even off-kit) and auto-correct phantom edits, while keeping initial generation faithful to the kit/Figma.

**Architecture:** Three independent, stackable changes. (1) Reframe the generator's instructions (`CLAUDE.md.tpl`) so the kit is a *default* for the unspecified but an *explicit request is law*. (2) A new server enrichment prepends a compact `<edit_context>` block (prompt-region text is obeyed harder than CLAUDE.md) on edit turns. (3) A phantom-edit detector re-runs the turn once on the same Claude session with a corrective instruction before falling back to the existing warning. Pieces 2 and 3 factor their decision logic into small pure modules that are unit-tested; the subprocess wiring lives in `chat.ts`.

**Tech Stack:** TypeScript, Node, Vitest, the Claude CLI subprocess (spawned via `runClaudeTurnWithRetry`), pnpm.

## Global Constraints

- Package manager is **pnpm**. Never `npm`/`yarn`. (CLAUDE.md)
- Tests run with `pnpm run studio:test <path>` for a single file (fast); `pnpm run studio:test` for the full suite (~90s). (studio/CLAUDE.md)
- Commits use **Conventional Commits**, scope `studio/<area>`. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. (CLAUDE.md)
- **Never `git add -A` / `git add .`** — stage explicit paths only. (CLAUDE.md)
- Vite middleware does **not** hot-reload — changes under `server/` need a full restart to take effect at runtime (irrelevant to tests). (studio/CLAUDE.md)
- Off-kit markup/CSS/inline-styles/arbitrary-Tailwind all render in dev AND share builds. The ONLY hard runtime limit: a frame cannot import an npm package that isn't installed. (spec)
- Off-kit stance: **obey, flag once** — implement the literal request, add ONE `### Deviations` line, no nagging. (spec)
- Initial-generation fidelity rules must NOT regress: the kit-strict rules apply only to what the designer did not specify. (spec)

---

## File Structure

- `studio/templates/CLAUDE.md.tpl` — **modify.** Add the two-tier authority principle; add an explicit-request exception to R3 (tokens); broaden the "kit can't express the request" section to cover explicit off-kit values + the uninstalled-library boundary.
- `studio/server/editContext.ts` — **create.** Pure builders `buildEditContextBlock` + `prependEditContext`. No I/O.
- `studio/server/phantomEditRetry.ts` — **create.** Pure policy `shouldRetryPhantomEdit` + `isMemoryOnlyPrompt` + the `PHANTOM_EDIT_RETRY_PROMPT` constant. No I/O.
- `studio/server/middleware/chat.ts` — **modify.** Widen `runClaudeBranch` ctx to carry `frames`; prepend edit-context to the turn prompt; insert the phantom-edit retry block in the existing no-change branch.
- `studio/__tests__/server/editContext.test.ts` — **create.** Unit tests for piece 2 pure fns.
- `studio/__tests__/server/phantomEditRetry.test.ts` — **create.** Unit tests for piece 3 pure fns.
- `studio/__tests__/server/claude-md-two-tier.test.ts` — **create.** Guard test pinning the new principle text in the template.

---

## Task 1: Reframe the generator instructions (Piece 1)

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl`
- Test: `studio/__tests__/server/claude-md-two-tier.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: stable substrings in the template that the guard test (and humans) rely on: `Two-tier authority`, `An explicit request is never a deviation you're allowed to decline`, `The token rule governs your guesses, not their instructions.`

- [ ] **Step 1: Write the failing guard test**

Create `studio/__tests__/server/claude-md-two-tier.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const TPL = readFileSync(
  new URL("../../templates/CLAUDE.md.tpl", import.meta.url),
  "utf-8",
);

describe("CLAUDE.md.tpl two-tier authority", () => {
  it("declares the two-tier authority principle", () => {
    expect(TPL).toContain("Two-tier authority");
  });

  it("states that an explicit request may not be declined, only flagged", () => {
    expect(TPL).toContain(
      "An explicit request is never a deviation you're allowed to decline",
    );
  });

  it("scopes the nearest-token rule to the agent's own guesses", () => {
    expect(TPL).toContain(
      "The token rule governs your guesses, not their instructions.",
    );
  });

  it("still tells the agent it cannot import an uninstalled library", () => {
    expect(TPL).toMatch(/do NOT add an import that isn't in the kit/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/claude-md-two-tier.test.ts`
Expected: FAIL — the four `toContain`/`toMatch` assertions fail (text not in template yet).

- [ ] **Step 3: Insert the two-tier authority section**

In `studio/templates/CLAUDE.md.tpl`, find this exact block (the end of the Goal section, around line 7):

```
You are building prototype frames for a designer. Speed matters more than completeness. A working frame in 2 minutes beats a perfect plan in 20. Implement directly; do not produce plan documents.
```

Replace it with that same paragraph followed by the new section:

```
You are building prototype frames for a designer. Speed matters more than completeness. A working frame in 2 minutes beats a perfect plan in 20. Implement directly; do not produce plan documents.

## Two-tier authority (read this first)

Two kinds of decisions, two different rules:

1. **What the designer did NOT specify** — the kit, the design system, and the Figma source are LAW. Use composites, named tokens, and the reference's exact shape. This is what keeps the first generation faithful; nothing below relaxes it.
2. **What the designer EXPLICITLY asked for** — the request is LAW, even when it breaks the kit. If they name an exact color, an exact size, a custom element, or a layout the kit has no slot for, build it LITERALLY — inline styles, a raw value, a hand-rolled `<div>`/`<svg>` — then note it in ONE `### Deviations` line. Never substitute the kit's version, never "snap to the nearest token", never refuse, never stall hunting for a slot that isn't there.

The one thing you genuinely cannot do is pull in a code library that isn't installed (a new icon set, a charting package) — those fail the build. When a request needs one, build the closest thing by hand and say so in `### Deviations`.

The kit is your default, not your cage. An explicit request is never a deviation you're allowed to decline — only one you must flag.
```

- [ ] **Step 4: Add the explicit-request exception to R3 (tokens)**

Find this exact block (R3, around lines 159-160):

```
**R3. Closed-world tokens.**
No arbitrary Tailwind brackets (`w-[1040px]`, `text-[17px]`, `bg-[#FF6B35]`, `rounded-[17px]`, `font-[440]`). All sizes, radii, colors, type, shadows, and spacing come from named utilities in the "Styling rules" section. If a Figma value doesn't map cleanly, pick the nearest named token — that's what the design system says the design intended.
```

Replace it with the same block plus a trailing exception paragraph:

```
**R3. Closed-world tokens.**
No arbitrary Tailwind brackets (`w-[1040px]`, `text-[17px]`, `bg-[#FF6B35]`, `rounded-[17px]`, `font-[440]`). All sizes, radii, colors, type, shadows, and spacing come from named utilities in the "Styling rules" section. If a Figma value doesn't map cleanly, pick the nearest named token — that's what the design system says the design intended.

**Exception — an explicit request overrides this.** "Pick the nearest token" applies only when YOU are choosing a value to fill a gap. When the designer names an exact value ("make it `#FF6B35`", "320px wide", "20px radius"), use that value verbatim — an arbitrary bracket or inline `style` is correct here — and flag it as a deviation. The token rule governs your guesses, not their instructions.
```

- [ ] **Step 5: Broaden the "kit can't express the request" section**

Find this exact line (item 3 of that section, around line 191):

```
3. **Flag it in `### Deviations`, in one line, in plain terms.** What you built, why (the kit has no slot for it), and — when there is one — a cleaner alternative the designer might prefer ("our top-nav has no room for extra actions; consider a toolbar row below it instead").
```

Replace it with that same line followed by a new paragraph:

```
3. **Flag it in `### Deviations`, in one line, in plain terms.** What you built, why (the kit has no slot for it), and — when there is one — a cleaner alternative the designer might prefer ("our top-nav has no room for extra actions; consider a toolbar row below it instead").

This applies equally to an explicit off-kit value or element the designer names directly ("add a bright-orange pill", "a 2px dashed divider", "a circular progress ring"). Same response: build the literal thing from primitives + raw markup, flag it once. If it would need an uninstalled library (a specific icon set, a chart lib), hand-roll the closest approximation and name the library that would do it cleanly — but do NOT add an import that isn't in the kit; it breaks the build.
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/claude-md-two-tier.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 7: Commit**

```bash
git add studio/templates/CLAUDE.md.tpl studio/__tests__/server/claude-md-two-tier.test.ts
git commit -m "feat(studio/templates): two-tier authority — kit default, explicit request is law

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Edit-context prompt injection (Piece 3)

**Files:**
- Create: `studio/server/editContext.ts`
- Test: `studio/__tests__/server/editContext.test.ts`
- Modify: `studio/server/middleware/chat.ts`

**Interfaces:**
- Consumes: the project's frame slugs (`project.frames` → `Frame[]`, each with a `slug: string`, defined in `studio/server/types.ts`).
- Produces:
  - `buildEditContextBlock(frameSlugs: string[]): string`
  - `prependEditContext(prompt: string, frameSlugs: string[]): string`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/editContext.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildEditContextBlock, prependEditContext } from "../../server/editContext";

describe("buildEditContextBlock", () => {
  it("lists the existing frame slugs and the two hard rules", () => {
    const block = buildEditContextBlock(["01-home", "02-settings"]);
    expect(block).toContain("<edit_context>");
    expect(block).toContain("</edit_context>");
    expect(block).toContain("01-home, 02-settings");
    expect(block).toContain("is LAW");
    expect(block).toContain("FAILED turn");
  });
});

describe("prependEditContext", () => {
  it("prepends the block when frames exist and prompt is a plain edit", () => {
    const out = prependEditContext("make the header red", ["01-home"]);
    expect(out.startsWith("<edit_context>")).toBe(true);
    expect(out).toContain("make the header red");
    expect(out).toContain("01-home");
  });

  it("is a no-op on the first build (no frames yet)", () => {
    expect(prependEditContext("build a settings page", [])).toBe(
      "build a settings page",
    );
  });

  it("does not double-inject when a client target preamble is present", () => {
    const prompt =
      "Target element: <div> inside <Frame>\nSource: frames/01-home/index.tsx:10:2\n\nmake it blue";
    expect(prependEditContext(prompt, ["01-home"])).toBe(prompt);
  });

  it("is idempotent when an edit_context block is already present", () => {
    const once = prependEditContext("tweak copy", ["01-home"]);
    expect(prependEditContext(once, ["01-home"])).toBe(once);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/editContext.test.ts`
Expected: FAIL — `Cannot find module '../../server/editContext'`.

- [ ] **Step 3: Create the editContext module**

Create `studio/server/editContext.ts`:

```ts
/**
 * Edit-context enrichment. When a project already has frames, a typed prompt
 * (one with no right-click "Target element" preamble) is almost always an EDIT
 * of an existing frame — yet the agent only infers that from chat history.
 * This prepends a compact, prompt-region block (prompt text is obeyed harder
 * than CLAUDE.md) that (a) names the existing frames and (b) restates the two
 * hard edit rules: explicit requests are law, and a reply with no real file
 * change is a failed turn.
 *
 * No-op on the first build (no frames) so initial-generation fidelity is
 * untouched, and on right-click edits (the client preamble in
 * src/components/chat/PromptInput.tsx already encodes the same discipline).
 * Pure — no I/O.
 */

/** Marker the client preamble (PromptInput.tsx) starts with. Its presence
 *  means the discipline is already prepended; we must not double-inject. */
const CLIENT_PREAMBLE_MARKER = "Target element:";
const EDIT_CONTEXT_MARKER = "<edit_context>";

export function buildEditContextBlock(frameSlugs: string[]): string {
  const list = frameSlugs.length ? frameSlugs.join(", ") : "(none)";
  return [
    "<edit_context>",
    "This project already has frames, so treat this turn as an edit of an existing",
    "frame unless the prompt clearly asks for a brand-new screen.",
    "",
    "- Anything the designer explicitly asks for is LAW. Implement it literally —",
    "  exact color, exact size, a hand-rolled element — even when it diverges from",
    "  the kit or the design system. Note the divergence in ONE ### Deviations line;",
    "  do NOT substitute the kit's version or snap to the nearest token.",
    "- A reply that describes a change without a matching Edit or Write tool call is",
    "  a FAILED turn. Read the target frame, make the real edit, then reply.",
    "",
    `Existing frames: ${list}`,
    "</edit_context>",
  ].join("\n");
}

export function prependEditContext(prompt: string, frameSlugs: string[]): string {
  if (!frameSlugs.length) return prompt;
  if (prompt.includes(CLIENT_PREAMBLE_MARKER)) return prompt;
  if (prompt.includes(EDIT_CONTEXT_MARKER)) return prompt;
  return `${buildEditContextBlock(frameSlugs)}\n\n${prompt}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/editContext.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Wire `prependEditContext` into `runClaudeBranch`**

In `studio/server/middleware/chat.ts`:

First add the import. Find this line (around line 28):

```ts
import { hasDeviationsSection, DEVIATIONS_MISSING_TRAILER } from "../deviationsContract";
```

Add directly after it:

```ts
import { prependEditContext } from "../editContext";
import type { Frame } from "../types";
```

Next, widen the `runClaudeBranch` ctx type. Find this block (around lines 568-575):

```ts
async function runClaudeBranch(ctx: {
  emit: (ev: StudioEvent) => void;
  slug: string;
  prompt: string;
  images?: string[];
  project: { sessionId?: string };
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
```

Replace the `project` line so the function can read the frame list:

```ts
async function runClaudeBranch(ctx: {
  emit: (ev: StudioEvent) => void;
  slug: string;
  prompt: string;
  images?: string[];
  project: { sessionId?: string; frames?: Frame[] };
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
```

Then prepend the edit-context block to the turn prompt. Find this line (around line 598):

```ts
  const { prompt, images } = enriched;
```

Replace it with:

```ts
  const { images } = enriched;
  // Established projects (existing frames) get a prompt-region edit-context
  // block that (a) names the frames and (b) restates the two hard edit rules.
  // No-op on the first build and on right-click edits — see editContext.ts.
  const frameSlugs = (project.frames ?? []).map((f) => f.slug);
  const prompt = prependEditContext(enriched.prompt, frameSlugs);
```

(The downstream `runClaudeTurnWithRetry({ ..., prompt, ... })` call already passes this `prompt`, so no further change is needed there.)

- [ ] **Step 6: Run the full server test suite to confirm nothing regressed**

Run: `pnpm run studio:test __tests__/server/`
Expected: PASS (existing suite green + the new `editContext.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add studio/server/editContext.ts studio/__tests__/server/editContext.test.ts studio/server/middleware/chat.ts
git commit -m "feat(studio/chat): inject edit-context block on edit turns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Phantom-edit auto-retry (Piece 2)

**Files:**
- Create: `studio/server/phantomEditRetry.ts`
- Test: `studio/__tests__/server/phantomEditRetry.test.ts`
- Modify: `studio/server/middleware/chat.ts`

**Interfaces:**
- Consumes:
  - `hasDeviationsSection(text: string): boolean` (from `../deviationsContract`, already imported in chat.ts) — used by the caller to compute `claimsEdit`.
  - `snapshotProjectFiles`, `diffSnapshots`, `hasAnyChange` (from `../frameChangeContract`, already imported).
  - `runClaudeTurnWithRetry` (from `../claudeCode`, already imported), `resolveClaudeBin` (already imported), `projectDir` (already imported).
  - The closure variables in `runClaudeBranch`: `capturedSessionId` (a `let`), `model`, `signal`, `beforeSnapshot`, `narrationTexts`, `toolLabels`, `emit`, `slug`.
- Produces:
  - `isMemoryOnlyPrompt(prompt: string): boolean`
  - `shouldRetryPhantomEdit(input: { fileChanged: boolean; claimsEdit: boolean; memoryOnly: boolean; alreadyRetried: boolean }): boolean`
  - `PHANTOM_EDIT_RETRY_PROMPT: string`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/phantomEditRetry.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  isMemoryOnlyPrompt,
  shouldRetryPhantomEdit,
  PHANTOM_EDIT_RETRY_PROMPT,
} from "../../server/phantomEditRetry";

describe("isMemoryOnlyPrompt", () => {
  it("matches a bare remember: directive", () => {
    expect(isMemoryOnlyPrompt("remember: always use teal accents")).toBe(true);
  });
  it("matches case-insensitively and ignores leading whitespace", () => {
    expect(isMemoryOnlyPrompt("  REMEMBER: x")).toBe(true);
  });
  it("does not match a normal edit prompt", () => {
    expect(isMemoryOnlyPrompt("make the header red")).toBe(false);
  });
  it("does not match 'remember' used mid-sentence", () => {
    expect(isMemoryOnlyPrompt("please remember to add a footer")).toBe(false);
  });
});

describe("shouldRetryPhantomEdit", () => {
  const base = { fileChanged: false, claimsEdit: true, memoryOnly: false, alreadyRetried: false };

  it("retries when the agent claimed an edit but no file moved", () => {
    expect(shouldRetryPhantomEdit(base)).toBe(true);
  });
  it("does not retry when a file actually changed", () => {
    expect(shouldRetryPhantomEdit({ ...base, fileChanged: true })).toBe(false);
  });
  it("does not retry a turn with no Deviations section (e.g. a flow question)", () => {
    expect(shouldRetryPhantomEdit({ ...base, claimsEdit: false })).toBe(false);
  });
  it("does not retry a bare remember: turn", () => {
    expect(shouldRetryPhantomEdit({ ...base, memoryOnly: true })).toBe(false);
  });
  it("does not retry more than once (one-shot guard)", () => {
    expect(shouldRetryPhantomEdit({ ...base, alreadyRetried: true })).toBe(false);
  });
});

describe("PHANTOM_EDIT_RETRY_PROMPT", () => {
  it("instructs the agent to re-read and actually edit", () => {
    expect(PHANTOM_EDIT_RETRY_PROMPT).toMatch(/re-read/i);
    expect(PHANTOM_EDIT_RETRY_PROMPT).toMatch(/Edit tool/i);
    expect(PHANTOM_EDIT_RETRY_PROMPT).toMatch(/did not land|no file was actually modified/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/phantomEditRetry.test.ts`
Expected: FAIL — `Cannot find module '../../server/phantomEditRetry'`.

- [ ] **Step 3: Create the phantomEditRetry module**

Create `studio/server/phantomEditRetry.ts`:

```ts
/**
 * Phantom-edit detection + retry policy. A "phantom edit" is a turn where the
 * agent's reply looks like a completed edit (it followed the response shape and
 * emitted a `### Deviations` section) but NO frame/shared file actually moved —
 * the worst failure mode in the product: the user is told a change shipped and
 * the viewport disagrees. Previously this produced only a post-turn warning;
 * this module decides when to RE-RUN the turn once with a corrective
 * instruction before falling back to that warning.
 *
 * Pure policy only — the actual re-spawn lives in server/middleware/chat.ts.
 */

/**
 * Bare `remember: …` turns legitimately touch only memory/LEARNED.md (outside
 * the frames/shared snapshot) and may still carry a Deviations section; they
 * must never be retried as phantom edits.
 */
export function isMemoryOnlyPrompt(prompt: string): boolean {
  return /^\s*remember:/i.test(prompt);
}

export function shouldRetryPhantomEdit(input: {
  /** Did any file under frames/ or shared/ move this turn. */
  fileChanged: boolean;
  /** Original narration contained a `### Deviations` section (i.e. the agent
   *  presented this as a completed edit). */
  claimsEdit: boolean;
  /** Prompt was a bare `remember:` directive. */
  memoryOnly: boolean;
  /** One-shot guard — we only ever retry a phantom edit once per turn. */
  alreadyRetried: boolean;
}): boolean {
  if (input.alreadyRetried) return false;
  if (input.fileChanged) return false;
  if (input.memoryOnly) return false;
  return input.claimsEdit;
}

/**
 * Corrective prompt fed to the resumed session when a phantom edit is detected.
 * Imperative + concrete: re-read, really edit, do not re-narrate.
 */
export const PHANTOM_EDIT_RETRY_PROMPT =
  "Your last reply described a change to the frame, but no file was actually modified — " +
  "the edit did not land. Re-read the target frame file now, then apply the change with the " +
  "Edit tool (or Write with the full file contents if Edit can't find a unique anchor). " +
  "Make the real change before replying; do not describe it again without editing. " +
  "Keep the same response shape: a one-sentence summary plus a ### Deviations section.";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/phantomEditRetry.test.ts`
Expected: PASS (10 passing).

- [ ] **Step 5: Wire the retry into the no-change branch of `runClaudeBranch`**

In `studio/server/middleware/chat.ts`, add the import. Find this line (the import added in Task 2):

```ts
import { prependEditContext } from "../editContext";
```

Add directly after it:

```ts
import {
  shouldRetryPhantomEdit,
  isMemoryOnlyPrompt,
  PHANTOM_EDIT_RETRY_PROMPT,
} from "../phantomEditRetry";
```

Now replace the no-change branch. Find this exact block (around lines 788-820):

```ts
    if (joined && afterDiff) {
      const diff = afterDiff;
      if (!hasAnyChange(diff)) {
        emit({ kind: "narration", text: NO_CHANGES_TRAILER.trimStart() });
        narrationTexts.push(NO_CHANGES_TRAILER.trimStart());
      }

      // A frame changed this turn — (1) stale-dismiss any pending chime-ins
      // about it (the objection may no longer apply) and (2) fire a silent
      // background drift check. Both are best-effort and never block the turn.
      const changedFrame = frameSlugFromDiff(diff);
```

Replace it with:

```ts
    if (joined && afterDiff) {
      let diff = afterDiff;

      // Phantom-edit self-correction: the agent emitted a complete reply (with
      // a ### Deviations section) but no file moved. Re-run the turn ONCE on
      // the same session with a corrective instruction before falling back to
      // the visible warning. Gated on a captured session id — a corrective
      // prompt on a fresh session would have no context and make things worse.
      if (
        capturedSessionId &&
        shouldRetryPhantomEdit({
          fileChanged: hasAnyChange(diff),
          claimsEdit: hasDeviationsSection(joined),
          memoryOnly: isMemoryOnlyPrompt(ctx.prompt),
          alreadyRetried: false,
        })
      ) {
        emit({ kind: "narration", text: "That change didn't land — reapplying it now…" });
        try {
          await runClaudeTurnWithRetry({
            cwd: projectDir(slug),
            prompt: PHANTOM_EDIT_RETRY_PROMPT,
            sessionId: capturedSessionId,
            bin: resolveClaudeBin(),
            model,
            signal,
            onEvent: (ev) => {
              if (ev.kind === "session") capturedSessionId = ev.sessionId;
              if (ev.kind === "narration") narrationTexts.push(ev.text);
              if (ev.kind === "tool_call") toolLabels.push(ev.pretty);
              // Keep the first attempt's metrics; the retry's end is
              // supplementary and must not flip the turn's terminal result.
              if (ev.kind === "turn_metrics") return;
              if (ev.kind === "end") return;
              emit(ev);
            },
          });
        } catch (err) {
          console.warn(`[studio] phantom-edit retry failed for ${slug}:`, err);
        }
        try {
          const afterRetry = await snapshotProjectFiles(projectDir(slug));
          diff = diffSnapshots(beforeSnapshot, afterRetry);
        } catch {
          /* snapshot best-effort — keep the prior diff */
        }
      }

      if (!hasAnyChange(diff)) {
        emit({ kind: "narration", text: NO_CHANGES_TRAILER.trimStart() });
        narrationTexts.push(NO_CHANGES_TRAILER.trimStart());
      }

      // A frame changed this turn — (1) stale-dismiss any pending chime-ins
      // about it (the objection may no longer apply) and (2) fire a silent
      // background drift check. Both are best-effort and never block the turn.
      const changedFrame = frameSlugFromDiff(diff);
```

(The rest of that block — the `markStaleByFrame` / `runDriftCheck` logic and the closing braces — is unchanged. It now operates on the final `diff`, which reflects the retry when one happened.)

- [ ] **Step 6: Type-check the middleware change**

Run: `pnpm run studio:test __tests__/server/chat-frame-slug-from-diff.test.ts`
Expected: PASS. (This imports from `chat.ts`, so it fails to load if the new code has a type/import error — a fast compile check for the edited file.)

- [ ] **Step 7: Run the full server suite**

Run: `pnpm run studio:test __tests__/server/`
Expected: PASS — existing suite green, plus `phantomEditRetry.test.ts` and the Task 2 / Task 1 additions.

- [ ] **Step 8: Commit**

```bash
git add studio/server/phantomEditRetry.ts studio/__tests__/server/phantomEditRetry.test.ts studio/server/middleware/chat.ts
git commit -m "feat(studio/chat): auto-retry phantom edits once before warning

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full-suite verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the complete test suite**

Run: `pnpm run studio:test`
Expected: PASS (full ~173-test suite green, including the 3 new files).

- [ ] **Step 2: Manual smoke (dev server)**

Run: `pnpm run studio`
Then, in the app:
1. Generate an initial frame from a prompt or Figma URL — confirm fidelity is unchanged (kit composites used, no spurious off-kit markup). *Protects requirement #1.*
2. On that frame, type an explicit off-kit edit, e.g. "make the page background `#FF6B35`". Confirm the literal color is applied and a single Deviations line flags it. *Validates requirement #2 + Piece 1/3.*
3. Type an edit that the agent has historically "claimed but didn't apply" (any small targeted tweak). If a phantom edit occurs, confirm the "reapplying it now…" narration appears and the change lands on the retry. *Validates Piece 2.*

Note: middleware changes require a full restart of `pnpm run studio` to take effect (Vite middleware does not hot-reload).

- [ ] **Step 3: No commit** — verification task only.

---

## Notes for the executor

- **0.38.0 is releasing in a parallel session.** These changes touch `CLAUDE.md.tpl`, `chat.ts`, and add new `server/` + `__tests__/` files. If `chat.ts` shows merge conflicts on commit, re-anchor the edits against the current file (the anchor strings in Tasks 2 & 3 are exact substrings; search for them).
- **Do not bump the version or edit CHANGELOG** — per auto-memory, fixes default to local-test only unless a release is explicitly requested.
- Each task is independently shippable; if time-boxed, Task 1 alone is a real improvement.
