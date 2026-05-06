# Deviations Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "surface deviations from the design system, stay terse" the default generator behavior, enforced at two layers: a system-prompt contract in `CLAUDE.md.tpl`, and a regex-based trailer in the chat middleware that warns the user when the agent skips the `### Deviations` section.

**Architecture:** Update the per-project system prompt (`studio/templates/CLAUDE.md.tpl`) with a "Response shape" + "What counts as a deviation" section. In `runClaudeBranch` inside [studio/server/middleware/chat.ts](../../../server/middleware/chat.ts), after the turn ends, check the concatenated narration for `### Deviations`; if missing, emit a synthetic `narration` event with a warning trailer AND push the same string into `narrationTexts` before persisting, so the live UI and reloaded history agree. Ship via bumped VERSION + CHANGELOG — `refreshStaleClaudeMd()` handles rollout on next launch.

**Tech Stack:** TypeScript, Node.js, Vite middleware, Vitest, the `claude` CLI run with `--bare`.

---

## Context for the implementer

A few non-obvious facts that matter for this task:

- The "system prompt" is not a string in code. It's a rendered `CLAUDE.md` file written per-project by [studio/server/projects.ts](../../../server/projects.ts) from the template at [studio/templates/CLAUDE.md.tpl](../../../templates/CLAUDE.md.tpl). Claude Code runs with `--bare` and `--add-dir <projectCwd>` and auto-reads `CLAUDE.md` from that dir. You don't need to pass it explicitly.
- When the template changes, `refreshStaleClaudeMd()` rewrites every project's `CLAUDE.md` on next studio launch AND clears each project's stored `sessionId`, so the next turn starts a fresh Claude session with the updated prompt. No migration code is needed.
- **Vite middleware does NOT hot-reload.** Changes to `server/middleware/chat.ts` require a full restart of `pnpm run studio`. (If you're running tests instead of the live studio, this doesn't apply — vitest reloads per run.)
- Chat history is persisted to `chatHistoryPath(slug)`. The live SSE stream and the persisted history are separate. To keep them in sync when we synthesize the trailer, emit a `narration` event AND push to `narrationTexts` before the `appendHistory` call.
- The contract is only for `runClaudeBranch`. `runComputerBranch` is untouched — `@Computer` turns don't generate kit frames.
- The SSE stream emits a terminal `end` event. The trailer must be emitted BEFORE `end`. The way the code is structured, we emit the trailer after `runClaudeTurnWithRetry` returns (so the claude CLI's own `end` has been intercepted and translated to `pendingEnd`, not yet forwarded to the SSE stream) and before `runClaudeBranch` returns its result to the outer `startTurn` call which triggers the registry's `end`. Concretely: inject the trailer right before the `appendHistory` block.

## File Structure

Files this plan touches:

| Path | Role | Change |
|---|---|---|
| [studio/templates/CLAUDE.md.tpl](../../../templates/CLAUDE.md.tpl) | Per-project system prompt (rendered at scaffold + stale-refresh) | Add "Response shape" section after "Execution discipline"; add "What counts as a deviation" section at the tail before "Where things live"; replace "When you're done" with a one-line pointer back to Response shape. |
| [studio/server/middleware/chat.ts](../../../server/middleware/chat.ts) | Chat turn runner (Claude + Computer branches) | In `runClaudeBranch`, after `runClaudeTurnWithRetry` returns, regex-check the joined narration for `### Deviations`. If missing, emit one synthetic `narration` event AND push to `narrationTexts` before `appendHistory`. |
| [studio/__tests__/server/middleware/chat-deviations.test.ts](../../../__tests__/server/middleware/chat-deviations.test.ts) | New — unit test for enforcement | Exercise the trailer logic against a synthetic narration buffer; verify both presence-pass and absence-appended cases. |
| [studio/packaging/VERSION](../../../packaging/VERSION) | Semver for DMG build | Bump `0.10.0` → `0.11.0`. |
| [studio/CHANGELOG.md](../../../CHANGELOG.md) | Keep-a-changelog style notes for "What's new" modal | Add `## [0.11.0]` entry with Added/Changed bullets. |

---

## Task 1: Extract the Deviations check into a pure function

We want the enforcement logic testable without standing up HTTP + a fake claude subprocess. Extract a small pure helper first.

**Files:**
- Create: `studio/server/deviationsContract.ts`
- Test: `studio/__tests__/server/deviationsContract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/deviationsContract.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { hasDeviationsSection, DEVIATIONS_MISSING_TRAILER } from "../../server/deviationsContract";

describe("hasDeviationsSection", () => {
  it("matches a standard ### Deviations heading", () => {
    const text = "Built the nav sidebar and breadcrumb.\n\n### Deviations\n\nNone.";
    expect(hasDeviationsSection(text)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const text = "Summary.\n\n### deviations\n\n- hand-rolled card";
    expect(hasDeviationsSection(text)).toBe(true);
  });

  it("matches with trailing content after the heading word", () => {
    const text = "Summary.\n\n### Deviations (3)\n\n- a\n- b";
    expect(hasDeviationsSection(text)).toBe(true);
  });

  it("does NOT match a bare prose 'Deviations:' without the ### prefix", () => {
    const text = "Summary. Deviations: I hand-rolled the card.";
    expect(hasDeviationsSection(text)).toBe(false);
  });

  it("does NOT match a heading with the wrong level (## instead of ###)", () => {
    const text = "Summary.\n\n## Deviations\n\n- something";
    expect(hasDeviationsSection(text)).toBe(false);
  });

  it("does NOT match an empty string", () => {
    expect(hasDeviationsSection("")).toBe(false);
  });

  it("does NOT match when the heading appears inside a code fence only", () => {
    // NOTE: simple regex match; this is deliberately best-effort. We accept
    // false positives from agents quoting their own contract, because
    // false-positive is "agent did the right thing" and costs nothing. What
    // we need to prevent is silent omission.
    const text = "Summary.\n```\n### Deviations\n```\n";
    expect(hasDeviationsSection(text)).toBe(true);
  });
});

describe("DEVIATIONS_MISSING_TRAILER", () => {
  it("contains a ### Deviations heading so the presence check would pass on re-run", () => {
    expect(hasDeviationsSection(DEVIATIONS_MISSING_TRAILER)).toBe(true);
  });

  it("contains the warning marker so the UI can visually distinguish it", () => {
    expect(DEVIATIONS_MISSING_TRAILER).toMatch(/⚠/);
  });

  it("starts with a blank-line separator so it joins cleanly to preceding narration", () => {
    expect(DEVIATIONS_MISSING_TRAILER.startsWith("\n\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/deviationsContract.test.ts`

Expected: FAIL with `Cannot find module '../../server/deviationsContract'` or similar.

- [ ] **Step 3: Write the minimal implementation**

Create `studio/server/deviationsContract.ts`:

```ts
/**
 * Regex that recognizes the required `### Deviations` section header at the
 * start of any line. Multiline + case-insensitive. Deliberately loose on
 * what can follow the word (`### Deviations`, `### deviations (3)`, etc.)
 * so the agent has room to annotate without breaking the contract.
 *
 * A bare prose "Deviations:" (no `###`) does NOT satisfy the contract — we
 * require the markdown heading shape so the check is verifiable by string
 * matching instead of structured parsing.
 */
const DEVIATIONS_HEADING = /^###\s+Deviations\b/mi;

/**
 * Synthetic trailer appended to a turn's narration when the agent failed to
 * emit a Deviations section. Leading `\n\n` is a section separator so the
 * trailer joins cleanly to whatever the agent wrote above.
 *
 * The trailer itself contains a valid `### Deviations` heading so a
 * re-check would pass — we have already applied the enforcement once, no
 * need to do it twice.
 */
export const DEVIATIONS_MISSING_TRAILER =
  "\n\n### Deviations\n\n" +
  "⚠ Agent did not emit a Deviations section — every response must list where the frame deviates from the design system, and why. Review the frame manually.";

/**
 * Returns true when `text` contains the required `### Deviations` section
 * header anywhere in its body. Used by the chat middleware to decide
 * whether to append DEVIATIONS_MISSING_TRAILER.
 */
export function hasDeviationsSection(text: string): boolean {
  return DEVIATIONS_HEADING.test(text);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/deviationsContract.test.ts`

Expected: PASS — all 10 test cases green.

- [ ] **Step 5: Commit**

```bash
git add studio/server/deviationsContract.ts studio/__tests__/server/deviationsContract.test.ts
git commit -m "feat(studio/chat): pure helper for deviations-section check"
```

---

## Task 2: Wire the check into `runClaudeBranch`

Integrate the helper into the live chat middleware. When the agent fails to emit a `### Deviations` section, emit a synthetic `narration` event AND push the trailer into `narrationTexts` so the persisted history matches the live stream.

**Files:**
- Modify: `studio/server/middleware/chat.ts` (the `runClaudeBranch` function, lines ~321-420)

- [ ] **Step 1: Add the import**

In [studio/server/middleware/chat.ts](../../../server/middleware/chat.ts), add the import alongside the existing imports at the top of the file. The import group currently ends with `import { startTurn, subscribe, getTurn } from "../turnRegistry";`. Add immediately after:

```ts
import { hasDeviationsSection, DEVIATIONS_MISSING_TRAILER } from "../deviationsContract";
```

- [ ] **Step 2: Inject the enforcement before `appendHistory`**

Locate the tail of `runClaudeBranch`:

```ts
  const endResult = pendingEnd ?? { ok: false, error: "Claude turn exited without reporting a result." };
  if (endResult.ok) {
    const content = narrationTexts.join("\n\n").trim();
    if (content || toolLabels.length > 0) {
      await appendHistory(slug, {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: content || toolLabels.join(" · "),
        source: "claude",
        createdAt: new Date().toISOString(),
      });
    }
  }
```

Replace it with:

```ts
  const endResult = pendingEnd ?? { ok: false, error: "Claude turn exited without reporting a result." };
  if (endResult.ok) {
    // Enforce the deviations-section contract defined in templates/CLAUDE.md.tpl.
    // If the agent produced narration at all and that narration doesn't contain
    // a `### Deviations` heading, append a visible warning trailer. Emitting
    // the trailer as a live `narration` event AND pushing it to narrationTexts
    // keeps the SSE view in agreement with what readHistory() will return
    // after reload.
    const joined = narrationTexts.join("\n\n").trim();
    if (joined && !hasDeviationsSection(joined)) {
      emit({ kind: "narration", text: DEVIATIONS_MISSING_TRAILER.trimStart() });
      narrationTexts.push(DEVIATIONS_MISSING_TRAILER.trimStart());
    }

    const content = narrationTexts.join("\n\n").trim();
    if (content || toolLabels.length > 0) {
      await appendHistory(slug, {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: content || toolLabels.join(" · "),
        source: "claude",
        createdAt: new Date().toISOString(),
      });
    }
  }
```

Notes:
- We call `trimStart()` on the trailer before emitting/pushing because the `"\n\n"` prefix is a joining separator; the join logic already inserts `\n\n` between pieces of `narrationTexts`, so a leading `\n\n` would double-space it.
- We only enforce when `joined` is non-empty. A turn that produced no narration at all (edge case: CLI crashed before any assistant text) isn't subject to the contract — there's nothing to append to. The existing `toolLabels.join(" · ")` fallback path for tool-only turns is also not subject to the contract.
- We deliberately do NOT enforce on `endResult.ok === false`. A turn that errored out is already being surfaced with its error; a missing-deviations warning would be noise.

- [ ] **Step 3: Run the existing chat tests to confirm we didn't break anything**

Run: `pnpm run studio:test __tests__/server/middleware/chat.test.ts`

Expected: PASS (all 4 existing tests green). The existing tests use a fake claude script that doesn't emit `### Deviations`; if those tests pass, it means the trailer injection is compatible with the fake's narration shape.

(If one of those tests now fails because the persisted `content` string changed, that's the enforcement working correctly. Update the test's assertion to accept the trailer. Document the change in the test's comment.)

- [ ] **Step 4: Commit**

```bash
git add studio/server/middleware/chat.ts
git commit -m "feat(studio/chat): enforce ### Deviations section on claude turns"
```

---

## Task 3: Integration test for the enforcement path

Write an integration-level test that exercises the middleware end-to-end (HTTP → fake claude → SSE → persisted history) and verifies the trailer is both streamed and persisted.

**Files:**
- Create: `studio/__tests__/server/middleware/chat-deviations.test.ts`
- Create: `studio/__tests__/fixtures/fake-claude-no-deviations.sh`
- Create: `studio/__tests__/fixtures/fake-claude-with-deviations.sh`

The existing `studio/__tests__/fixtures/fake-claude.sh` shows the stream-json shape we need to match: a `system` init event carrying a session id, one `assistant` event with the narration text, and a terminal `result` with `subtype=success`. We'll create two new fakes that use the same structure but different narration text.

- [ ] **Step 1: Create the "no deviations" fake**

Create `studio/__tests__/fixtures/fake-claude-no-deviations.sh` with this exact content:

```bash
#!/usr/bin/env bash
# Fake claude CLI — scenario: assistant produces a response with NO
# `### Deviations` section. Used to verify the chat middleware appends a
# warning trailer.
if [ -n "$ARCADE_TEST_PROMPT_OUT" ]; then
  printf "%s\n" "$@" > "$ARCADE_TEST_PROMPT_OUT"
fi
printf '{"type":"system","subtype":"init","session_id":"sess-no-dev"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Built the frame."}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
```

Make it executable:

```bash
chmod +x studio/__tests__/fixtures/fake-claude-no-deviations.sh
```

- [ ] **Step 2: Create the "with deviations" fake**

Create `studio/__tests__/fixtures/fake-claude-with-deviations.sh` with this exact content:

```bash
#!/usr/bin/env bash
# Fake claude CLI — scenario: assistant produces a response WITH a valid
# `### Deviations` section. Used to verify the middleware passes the
# response through unchanged.
if [ -n "$ARCADE_TEST_PROMPT_OUT" ]; then
  printf "%s\n" "$@" > "$ARCADE_TEST_PROMPT_OUT"
fi
printf '{"type":"system","subtype":"init","session_id":"sess-has-dev"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Built the frame.\\n\\n### Deviations\\n\\nNone."}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
```

Make it executable:

```bash
chmod +x studio/__tests__/fixtures/fake-claude-with-deviations.sh
```

The `\\n` sequences are intentional: they're literal `\n` in the shell script, which bash's `printf` renders as newlines when emitting the JSON line. The resulting JSON string contains `\n` escape sequences inside the `text` field, which is what `streamJson.ts` expects.

- [ ] **Step 3: Write the failing integration test**

Create `studio/__tests__/server/middleware/chat-deviations.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chatMiddleware } from "../../../server/middleware/chat";
import { createProject } from "../../../server/projects";
import { __resetTurnRegistryForTests } from "../../../server/turnRegistry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAKE_NO = path.join(__dirname, "../../fixtures/fake-claude-no-deviations.sh");
const FAKE_YES = path.join(__dirname, "../../fixtures/fake-claude-with-deviations.sh");

let tmp: string; let server: http.Server; let port: number;

beforeAll(() => {
  fs.chmodSync(FAKE_NO, 0o755);
  fs.chmodSync(FAKE_YES, 0o755);
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-deviations-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  process.env.ARCADE_STUDIO_SKIP_SSO_CHECK = "1";
  __resetTurnRegistryForTests();
  server = http.createServer(chatMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  __resetTurnRegistryForTests();
  delete process.env.ARCADE_STUDIO_ROOT;
  delete process.env.ARCADE_STUDIO_CLAUDE_BIN;
  delete process.env.ARCADE_STUDIO_SKIP_SSO_CHECK;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function drainStream(slug: string): Promise<string> {
  const res = await fetch(`http://localhost:${port}/api/chat/stream/${slug}`);
  return res.text();
}

async function startTurnAndDrain(slug: string): Promise<string> {
  const post = await fetch(`http://localhost:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, prompt: "go" }),
  });
  expect(post.status).toBe(202);
  return drainStream(slug);
}

describe("deviations contract enforcement", () => {
  it("appends a warning trailer when the agent omits ### Deviations", async () => {
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_NO;
    const p = await createProject({ name: "No Dev", theme: "arcade", mode: "light" });

    const stream = await startTurnAndDrain(p.slug);

    // The synthetic narration must appear in the SSE stream so the live UI
    // sees the warning.
    expect(stream).toContain("### Deviations");
    expect(stream).toContain("Agent did not emit a Deviations section");

    // AND it must be persisted to chat history so the warning survives reload.
    const historyPath = path.join(tmp, "projects", p.slug, "chat-history.json");
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const assistant = history.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.content).toMatch(/### Deviations/);
    expect(assistant.content).toMatch(/Agent did not emit a Deviations section/);
  });

  it("passes through unchanged when the agent emits ### Deviations", async () => {
    process.env.ARCADE_STUDIO_CLAUDE_BIN = FAKE_YES;
    const p = await createProject({ name: "Has Dev", theme: "arcade", mode: "light" });

    const stream = await startTurnAndDrain(p.slug);

    // The stream contains ONE copy of the Deviations heading (the agent's),
    // not two (agent's + trailer's).
    const matches = stream.match(/### Deviations/g) ?? [];
    expect(matches.length).toBe(1);
    expect(stream).not.toContain("Agent did not emit a Deviations section");

    const historyPath = path.join(tmp, "projects", p.slug, "chat-history.json");
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    const assistant = history.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.content).toMatch(/### Deviations\n\nNone\./);
    expect(assistant.content).not.toMatch(/Agent did not emit/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails only for the right reason**

Run: `pnpm run studio:test __tests__/server/middleware/chat-deviations.test.ts`

Expected: PASS — if both tests pass immediately, Task 2's wiring was correct. If either fails, the failure should point at actual enforcement behavior, not missing fixtures or import errors.

If the test fails with `ENOENT` on a fixture path, re-check that steps 1 and 2 created the two shell-script fakes and that they're `chmod +x`.

- [ ] **Step 5: Run the full studio test suite to catch any regressions**

Run: `pnpm run studio:test`

Expected: PASS — all tests green, including the pre-existing `chat.test.ts` suite.

- [ ] **Step 6: Commit**

```bash
git add studio/__tests__/server/middleware/chat-deviations.test.ts studio/__tests__/fixtures/fake-claude-no-deviations.sh studio/__tests__/fixtures/fake-claude-with-deviations.sh
git commit -m "test(studio/chat): integration coverage for deviations-section enforcement"
```

---

## Task 4: Update the system-prompt template

Rewrite the per-project `CLAUDE.md.tpl` to tell the agent about the new response shape and what counts as a deviation. Fold the old "When you're done" section in.

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl`

- [ ] **Step 1: Add a "Response shape" section**

Open [studio/templates/CLAUDE.md.tpl](../../../templates/CLAUDE.md.tpl). Find the section starting with `## Execution discipline` near the top. AFTER that section (before the `## How to work` section that begins "You are fast when you act…"), insert a new section:

```markdown
## Response shape (non-optional)

Every response you write has exactly this shape:

1. **One-sentence summary** of what changed in the frame. No technical jargon, no file paths, no tool names, no play-by-play of what you did. The frames render — the user can see what happened. Speak about the design, not the implementation.
2. **A `### Deviations` section.** Either a bulleted list of specific deviations from the design system, or the literal line `None.` when the whole frame maps cleanly to the kit.

The `### Deviations` section is non-optional. Even a trivial edit ("change the heading") gets `### Deviations\n\nNone.` appended.

Do NOT explain what you did. The deviations section IS the explanation. Do NOT pad with "I chose X because…" prose before the bullets. Each bullet: *what* deviated, *why*, and a suggested kit alternative when one exists. One line per bullet. Example:

```
Built the nav and breadcrumb from the kit.

### Deviations

- Dual sidebar — kit exposes one sidebar slot. Stacked two NavSidebars side by side; cleaner option is to hand-roll the outer shell.
- Active-pill color — mockup shows neutral gray, kit default is blue. Used neutral.
- Progress bar — no arcade primitive exists. Hand-rolled with `--bg-neutral-soft` + `--bg-neutral-prominent`. Flag if a primitive is wanted.
```

Keep the summary under 20 words. Keep each deviation bullet under 25 words. A terse, scannable list beats a complete-sentence explanation.
```

- [ ] **Step 2: Add a "What counts as a deviation" section**

Find the section header `## Where things live` near the bottom of the template (around line 429 in the current file). Immediately BEFORE that section, insert:

```markdown
## What counts as a deviation

A deviation is anything the generated frame does that isn't a straight-through use of a kit composite, template, primitive, or token. List every one in your `### Deviations` section. Concrete cases you MUST list:

- **Hand-rolled chrome** where a composite would normally slot in (a bare `<aside>` used instead of `NavSidebar`, a bare `<header>` instead of `TitleBar`, a bordered group of rows built by hand instead of `SettingsCard`).
- **Raw Tailwind brackets** (`w-[1040px]`, `text-[17px]`, `rounded-[17px]`) or hardcoded hex/rgb colors. These are also build-breakers per the "Styling rules" section — but the deviations section lets the user see you made the choice deliberately.
- **A color used that doesn't map cleanly to a token.** If Figma shows neutral gray for an active-state pill where the kit default is blue, you picked one or the other. Say which, and why.
- **An icon you used that's not from `arcade/components`.** (Ideally blocked by the import-validation hook, but flag it if it slipped through.)
- **A composite prop you invented** because the Figma node didn't supply it (a `title=` on `PageBody` when Figma had no title, a `workspace=` on `NavSidebar` when the Figma sidebar had no brand header).
- **A Figma node you couldn't resolve** to any kit piece and ended up with a `{/* TODO */}` gap per R4.
- **A primitive hand-rolled with raw `<div>` + Tailwind** because no matching primitive exists (a progress bar, a split pane divider, etc.).

When in doubt, over-report. A `### Deviations` section that lists something trivial is infinitely better than one that hides a real deviation. The user's job is to decide whether each deviation is acceptable; your job is to surface them.

If the whole frame maps cleanly — every piece is a template, composite, primitive, or token used as intended — write `None.` Do NOT pad with "this was a clean implementation" prose.
```

- [ ] **Step 3: Replace "When you're done"**

Find the final section of the template:

```markdown
## When you're done

After writing a frame, stop. Do not write follow-up markdown, do not summarize what you did, do not start another frame unsolicited.
```

Replace it with:

```markdown
## When you're done

After writing a frame, write your one-sentence summary + `### Deviations` section per "Response shape" above, then stop. Do not write follow-up markdown, do not restate what you did in prose, do not start another frame unsolicited.
```

- [ ] **Step 4: Sanity-check the template still renders**

Run: `pnpm run studio:test __tests__/server/projects.test.ts`

Expected: PASS. The existing projects tests exercise template rendering via `createProject`; they'll fail loudly if any `{{PROTOTYPER}}` / `{{ARCADE}}` / `{{PROJECT_NAME}}` / `{{THEME}}` substitutions are broken by the edit. (They shouldn't be — we only added plain markdown, no new placeholders.)

- [ ] **Step 5: Commit**

```bash
git add studio/templates/CLAUDE.md.tpl
git commit -m "feat(studio/generator): deviations contract in system prompt"
```

---

## Task 5: Bump version and changelog

Ship the change as `0.11.0`. The app's first-launch `refreshStaleClaudeMd()` call will re-render every existing project's `CLAUDE.md` and clear their `sessionId`s, so beta testers get the new prompt automatically on next launch with no manual migration.

**Files:**
- Modify: `studio/packaging/VERSION`
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Bump the version file**

Replace the contents of `studio/packaging/VERSION` with:

```
0.11.0
```

(Single line, no trailing newline changes.)

- [ ] **Step 2: Add a changelog entry**

Open `studio/CHANGELOG.md`. Read the top 3 entries to copy their keep-a-changelog structure. Insert a new entry at the top (above the previous `## [0.10.0]` entry):

```markdown
## [0.11.0] — 2026-05-06

### Added
- Generator now ends every response with a required `### Deviations` section listing where the frame deviated from the design system (hand-rolled chrome, off-token colors, invented props, `{/* TODO */}` gaps). Designers see all deviations inline instead of relying on the agent's discretion.

### Changed
- System prompt reshaped around a strict response shape: one-sentence summary + bulleted deviations. Verbose technical narration ("I read the manifest, then wrote the file…") is suppressed.

### Fixed
- When the generator skips the deviations contract, the chat now shows a visible warning trailer instead of silently letting the omission through.
```

- [ ] **Step 3: Run the full test suite one more time**

Run: `pnpm run studio:test`

Expected: PASS — everything green.

- [ ] **Step 4: Commit**

```bash
git add studio/packaging/VERSION studio/CHANGELOG.md
git commit -m "chore(studio): bump to 0.11.0 — deviations contract"
```

---

## Task 6: Manual smoke check (run locally before tagging a release)

The agent-facing behavior can't be fully exercised by unit tests; Bedrock calls real claude with the real template. This task is a human smoke check — run it before publishing the DMG.

**Files:** none modified.

- [ ] **Step 1: Start the studio against a real Bedrock backend**

```bash
pnpm run studio
```

Wait for the browser to open on `localhost:5556`.

- [ ] **Step 2: Verify `refreshStaleClaudeMd` ran**

On startup, studio should log a line like `[studio] refreshed CLAUDE.md for N projects` when the template changed. Confirm at least one project was refreshed. Spot-check one project's rendered file:

```bash
ls ~/Library/Application\ Support/arcade-studio/projects/ | head -1
cat ~/Library/Application\ Support/arcade-studio/projects/<first-slug>/CLAUDE.md | grep -A 3 "Response shape"
```

Expected: the new "Response shape (non-optional)" section is present.

- [ ] **Step 3: Drive a clean prompt (standard mode)**

Open any existing project, type a simple prompt like `make a settings page with two sections`. Expect: the assistant's final message is a one-sentence summary followed by `### Deviations\n\nNone.` (or a very short list). No walls of technical narration.

- [ ] **Step 4: Drive a mixed prompt (exploratory mode)**

Type a prompt that forces deviation, similar to the beta tester's original Figma-in-system case:
`Replicate this design using our design system. https://www.figma.com/design/dHEyK3XWnLEWbTBmF7crQ8/Teams-and-navigation--Polina-?node-id=1823-1866`

Expect: the response surfaces specific deviations as bullets (dual sidebar, color token mismatches, missing progress-bar primitive, etc.) without you having to ask for them.

- [ ] **Step 5: Force the missing-trailer path**

(Optional — only reproducible if you can induce the agent to skip the section.) If the agent ever skips the deviations heading, verify the UI shows the `⚠ Agent did not emit a Deviations section…` trailer inline with the turn.

If steps 3 and 4 look right, the implementation is ready to ship.

- [ ] **Step 6: (When ready to release) build the DMG and publish**

```bash
pnpm run studio:pack
```

Then follow the "Releasing a new version" checklist in [studio/CLAUDE.md](../../../CLAUDE.md) to publish `v0.11.0` to the public mirror repo.

---

## Spec ↔ plan coverage check

| Spec requirement | Task(s) |
|---|---|
| Template adds "Response shape" section | Task 4, Step 1 |
| Template adds "What counts as a deviation" section | Task 4, Step 2 |
| Old "When you're done" folds into Response shape | Task 4, Step 3 |
| `runClaudeBranch` regex-checks for `### Deviations` | Task 1 + Task 2 |
| Missing section → trailer appended to persisted history | Task 2 |
| Missing section → trailer emitted on live SSE stream | Task 2 |
| Computer turns (`runComputerBranch`) NOT affected | Task 2 (scope confined) + Task 3 (integration test only exercises Claude branch) |
| Error turns (`endResult.ok === false`) NOT affected | Task 2 (guarded by `if (endResult.ok)`) |
| Casing on heading is insensitive | Task 1, Step 1 test case + regex flag |
| Bare prose "Deviations:" fails the contract | Task 1, Step 1 test case |
| `refreshStaleClaudeMd()` rolls out the template | (No new code — it just works; verified in Task 6, Step 2) |
| Bump VERSION + CHANGELOG | Task 5 |
