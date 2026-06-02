# Computer Context-Aware Co-Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Studio's Computer agent project-aware on summon, and have it silently watch each frame generation and chime in (inline, collapsible, Apply/Dismiss) only when the prototype drifts from how DevRev actually works.

**Architecture:** A pure server-side context builder (`buildComputerContext`) assembles project summary + pending chime-ins + current frame source + recent chat history into one ≤50KB block. Two consumers use it: (1) the manual `@Computer` branch prepends it to the user's question; (2) a fire-and-forget drift check runs after each Claude turn that wrote a frame, asking Computer to reply `NONE` or a concrete objection. Objections persist as `ChimeIn` records on the project and render as inline collapsed notes in the chat with Apply (re-prompts the code agent) / Dismiss buttons.

**Tech Stack:** TypeScript, Node (Vite middleware), React, Vitest, Zod. No new dependencies.

---

## Background the implementer must know

**The two agents** (`studio/server/middleware/chat.ts`):
- Default **code agent** = `claude` CLI subprocess via `runClaudeBranch`.
- **Computer** = stateless REST call to DevRev agent/620 via `runComputerTurn` (`server/devrev/computerAgent.ts`). Today it gets ONLY the user's cleaned prompt + optional `#frame` source.

**Hard constraints (do not violate):**
- agent/620 has **no filesystem tools** — everything must be in the payload.
- DevRev SDK truncates payloads **over ~50KB** to a 2KB preview. Context block MUST stay under budget.
- agent/620 **fabricates live org data** — so drift detection is grounded in Computer's *general DevRev product judgment*, NOT live data. Never tell it to fetch org objects.
- **Vite middleware does not hot-reload** — `pnpm run studio` must be fully restarted to test server changes.

**Existing patterns to mirror:**
- Frame source reading: `readFrameSources(slug)` in `chat.ts:50-80` (60KB char budget, fenced blocks).
- Snapshot/diff for "did a frame change": `snapshotProjectFiles` / `diffSnapshots` / `hasAnyChange` in `server/frameChangeContract.ts`. `runClaudeBranch` already takes a `beforeSnapshot` at `chat.ts:541` and computes `afterSnapshot` at `chat.ts:630`.
- Persisting per-project state: `updateProject(slug, patch)` in `server/projects.ts:299`. New optional fields go on `projectSchema` in `server/types.ts`.
- Chat history read: `readHistory(slug)` in `server/projects.ts:212`.
- Trailer-split UI pattern: `splitNoChangesTrailer` + `NoFrameChangesBanner` in `src/components/chat/NoFrameChangesBanner.tsx`.
- Component tests mock `@xorkavi/arcade-gen` (see `__tests__/components/messageList-journey.test.tsx:12-19`).
- History refresh event: `window.dispatchEvent(new CustomEvent("arcade-studio:refresh-chat-history"))` — host hook re-pulls history on it (`useProjectFromHost.ts:114`).

**Commands:**
- Single test file (fast): `pnpm run studio:test <path>`
- Full suite: `pnpm run studio:test`
- Run app: `pnpm run studio`

**Commit discipline:** Conventional Commits, scope `studio/<area>`. Stage explicit paths only — NEVER `git add -A`.

---

## File structure

**Create:**
- `studio/server/devrev/computerContext.ts` — pure `buildComputerContext` assembly + budget. No network.
- `studio/server/devrev/driftCheck.ts` — `runDriftCheck` + `parseDriftResponse`. Calls Computer; persists chime-ins.
- `studio/server/chimeIns.ts` — chime-in persistence helpers (add/dedup/dismiss/stale) over `project.chimeIns`.
- `studio/src/components/chat/computer/ChimeInNote.tsx` — inline collapsed-note component.
- `studio/__tests__/server/devrev/computerContext.test.ts`
- `studio/__tests__/server/devrev/driftCheck.test.ts`
- `studio/__tests__/server/chimeIns.test.ts`
- `studio/__tests__/components/chat/chime-in-note.test.tsx`

**Modify:**
- `studio/server/types.ts` — add `ChimeIn` schema + `project.chimeIns`.
- `studio/server/middleware/chat.ts` — context on summon (`runComputerBranch`), drift-check trigger (`runClaudeBranch`), chime-in REST endpoints.
- `studio/server/middleware/projects.ts` — GET chime-ins, POST dismiss.
- `studio/src/components/chat/MessageList.tsx` — render chime-in notes.
- `studio/src/components/chat/ChatPane.tsx` — thread chime-ins + handlers.
- `studio/src/routes/ProjectDetail.tsx` — fetch chime-ins, pass to ChatPane.

---

## Task 1: ChimeIn type + project field

**Files:**
- Modify: `studio/server/types.ts`
- Test: `studio/__tests__/server/chimeIns.test.ts` (created here, expanded in Task 3)

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/chimeIns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { projectSchema, chimeInSchema } from "../../server/types";

describe("ChimeIn schema", () => {
  it("parses a valid chime-in", () => {
    const c = chimeInSchema.parse({
      id: "ci-1",
      frameSlug: "01-dashboard",
      objection: "Tickets don't auto-close on assignment in DevRev.",
      createdAt: "2026-06-02T00:00:00.000Z",
      status: "pending",
    });
    expect(c.status).toBe("pending");
  });

  it("defaults project.chimeIns to an empty array", () => {
    const p = projectSchema.parse({
      name: "x",
      slug: "x",
      createdAt: "t",
      updatedAt: "t",
      theme: "arcade",
      mode: "light",
    });
    expect(p.chimeIns).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/chimeIns.test.ts`
Expected: FAIL — `chimeInSchema` is not exported.

- [ ] **Step 3: Add the schema + field**

In `studio/server/types.ts`, after `frameSchema` (before `projectSchema`):

```ts
export const chimeInSchema = z.object({
  id: z.string(),
  /** Frame the objection is about; used for staleness auto-dismiss. */
  frameSlug: z.string(),
  /** Computer's concrete product-truth objection. */
  objection: z.string(),
  createdAt: z.string(),
  status: z.enum(["pending", "applied", "dismissed"]).default("pending"),
});
export type ChimeIn = z.infer<typeof chimeInSchema>;
```

Inside `projectSchema`, after the `computerConversationId` line:

```ts
  chimeIns: z.array(chimeInSchema).default([]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/chimeIns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/types.ts studio/__tests__/server/chimeIns.test.ts
git commit -m "feat(studio/types): add ChimeIn schema and project.chimeIns field"
```

---

## Task 2: Context builder (`buildComputerContext`)

**Files:**
- Create: `studio/server/devrev/computerContext.ts`
- Test: `studio/__tests__/server/devrev/computerContext.test.ts`

The builder is pure: it takes already-loaded inputs (project summary string, pending chime-ins, frame source, recent history) and returns a single capped string. The middleware does the IO and passes values in — this keeps the unit network-free and test-trivial.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/devrev/computerContext.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildComputerContext, COMPUTER_CONTEXT_BUDGET } from "../../../server/devrev/computerContext";

describe("buildComputerContext", () => {
  it("includes all four sections when present", () => {
    const out = buildComputerContext({
      projectSummary: "Project: Helpdesk. Goal: triage screen.",
      pendingChimeIns: ["Tickets don't auto-close like that."],
      frameSource: "### frame: 01-x\n\n```tsx\nexport default ()=>null\n```",
      recentHistory: [
        { role: "user", content: "build a triage screen" },
        { role: "assistant", content: "Done." },
      ],
    });
    expect(out).toContain("Helpdesk");
    expect(out).toContain("auto-close");
    expect(out).toContain("01-x");
    expect(out).toContain("triage screen");
  });

  it("omits empty sections without throwing", () => {
    const out = buildComputerContext({
      projectSummary: "Project: Empty.",
      pendingChimeIns: [],
      frameSource: "",
      recentHistory: [],
    });
    expect(out).toContain("Empty");
    expect(out).not.toContain("Recent conversation");
    expect(out).not.toContain("Open product-truth notes");
  });

  it("stays under budget by trimming history first", () => {
    const huge = Array.from({ length: 5000 }, (_, i) => ({
      role: "user" as const,
      content: `line ${i} ${"x".repeat(40)}`,
    }));
    const out = buildComputerContext({
      projectSummary: "Project: Big.",
      pendingChimeIns: [],
      frameSource: "### frame: 01\n\n```tsx\n" + "y".repeat(2000) + "\n```",
      recentHistory: huge,
    });
    expect(out.length).toBeLessThanOrEqual(COMPUTER_CONTEXT_BUDGET);
    // Frame + summary survive; history is what gets cut.
    expect(out).toContain("Big");
    expect(out).toContain("frame: 01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/devrev/computerContext.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

Create `studio/server/devrev/computerContext.ts`:

```ts
/**
 * Pure assembly of the context block sent to the Computer (DevRev agent/620)
 * on both manual @Computer summons and silent drift checks.
 *
 * agent/620 has no filesystem access, so everything it can "see" about the
 * project must be in this block. DevRev's SDK truncates payloads over ~50KB
 * to a 2KB preview, so we hard-cap the block well under that and trim the
 * lowest-signal section (raw chat history) first.
 *
 * Pure function: the middleware loads the project / frames / history and
 * passes the values in. No IO here so it's trivially testable.
 */

/** Char budget for the whole context block. Kept under DevRev's ~50KB cap
 *  with headroom for the user's own question that gets appended after it. */
export const COMPUTER_CONTEXT_BUDGET = 40_000;

export interface ComputerContextInput {
  /** One-paragraph standing brief: name, goal, what's built. */
  projectSummary: string;
  /** Objection text of pending chime-ins (already filtered to pending). */
  pendingChimeIns: string[];
  /** Pre-rendered frame source (fenced blocks), or "" if none. */
  frameSource: string;
  /** Recent user<->code-agent turns, oldest first. */
  recentHistory: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}

export function buildComputerContext(input: ComputerContextInput): string {
  const summary = `Project context\n${input.projectSummary.trim()}`;

  const notes =
    input.pendingChimeIns.length > 0
      ? `Open product-truth notes you raised earlier (unresolved):\n` +
        input.pendingChimeIns.map((o) => `- ${o}`).join("\n")
      : "";

  const frame =
    input.frameSource.trim().length > 0
      ? `Current frame source (what the code agent just built):${input.frameSource}`
      : "";

  // Build the always-on prefix first; history fills whatever budget remains.
  const fixedParts = [summary, notes, frame].filter(Boolean);
  const fixed = fixedParts.join("\n\n");

  const remaining = COMPUTER_CONTEXT_BUDGET - fixed.length - 64; // 64 = separator/header slack
  let history = "";
  if (input.recentHistory.length > 0 && remaining > 0) {
    const lines: string[] = [];
    let used = 0;
    // Walk newest -> oldest, dropping the oldest when over budget, then reverse.
    for (let i = input.recentHistory.length - 1; i >= 0; i -= 1) {
      const m = input.recentHistory[i];
      const line = `${m.role}: ${m.content}`;
      if (used + line.length > remaining) break;
      lines.push(line);
      used += line.length + 1;
    }
    if (lines.length > 0) {
      history = `Recent conversation (oldest first):\n` + lines.reverse().join("\n");
    }
  }

  const all = [fixed, history].filter(Boolean).join("\n\n");
  // Defensive final clamp (e.g. a single giant frame): never exceed budget.
  return all.length > COMPUTER_CONTEXT_BUDGET
    ? all.slice(0, COMPUTER_CONTEXT_BUDGET - 24) + "\n\n[context truncated]"
    : all;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/devrev/computerContext.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/server/devrev/computerContext.ts studio/__tests__/server/devrev/computerContext.test.ts
git commit -m "feat(studio/computer): pure context builder for Computer payloads"
```

---

## Task 3: Chime-in persistence helpers

**Files:**
- Create: `studio/server/chimeIns.ts`
- Test: `studio/__tests__/server/chimeIns.test.ts` (extend Task 1 file)

These are pure list transforms over `ChimeIn[]`. The middleware reads `project.chimeIns`, applies a transform, and writes back via `updateProject` — so the transforms themselves are network-free and unit-testable.

- [ ] **Step 1: Write the failing test**

Append to `studio/__tests__/server/chimeIns.test.ts`:

```ts
import {
  addChimeIn,
  dismissChimeIn,
  markStaleByFrame,
  pendingObjections,
} from "../../server/chimeIns";
import type { ChimeIn } from "../../server/types";

const base: ChimeIn = {
  id: "ci-1",
  frameSlug: "01-x",
  objection: "Tickets don't auto-close.",
  createdAt: "t1",
  status: "pending",
};

describe("chime-in transforms", () => {
  it("adds a new chime-in", () => {
    const next = addChimeIn([], { frameSlug: "01-x", objection: "A", id: "ci-9", createdAt: "t" });
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("pending");
  });

  it("dedups an identical pending objection on the same frame", () => {
    const start = [base];
    const next = addChimeIn(start, { frameSlug: "01-x", objection: "Tickets don't auto-close.", id: "ci-2", createdAt: "t2" });
    expect(next).toHaveLength(1);
  });

  it("marks pending chime-ins for a changed frame as dismissed (stale)", () => {
    const next = markStaleByFrame([base], "01-x");
    expect(next[0].status).toBe("dismissed");
  });

  it("does not touch chime-ins for other frames when marking stale", () => {
    const next = markStaleByFrame([base], "02-other");
    expect(next[0].status).toBe("pending");
  });

  it("dismisses by id", () => {
    const next = dismissChimeIn([base], "ci-1");
    expect(next[0].status).toBe("dismissed");
  });

  it("returns only pending objection strings", () => {
    const mixed: ChimeIn[] = [base, { ...base, id: "ci-2", status: "dismissed", objection: "B" }];
    expect(pendingObjections(mixed)).toEqual(["Tickets don't auto-close."]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/chimeIns.test.ts`
Expected: FAIL — `../../server/chimeIns` not found.

- [ ] **Step 3: Implement the helpers**

Create `studio/server/chimeIns.ts`:

```ts
import type { ChimeIn } from "./types";

/**
 * Pure transforms over a project's chime-in list. The caller owns IO:
 * read project.chimeIns, apply a transform, persist via updateProject.
 */

export interface NewChimeIn {
  id: string;
  frameSlug: string;
  objection: string;
  createdAt: string;
}

/** Append a chime-in, unless an identical pending objection already exists
 *  for the same frame (dedup across consecutive turns). */
export function addChimeIn(list: ChimeIn[], next: NewChimeIn): ChimeIn[] {
  const dup = list.some(
    (c) =>
      c.status === "pending" &&
      c.frameSlug === next.frameSlug &&
      c.objection.trim() === next.objection.trim(),
  );
  if (dup) return list;
  return [...list, { ...next, status: "pending" }];
}

/** Auto-dismiss pending chime-ins about a frame that has since changed —
 *  the objection may no longer apply. */
export function markStaleByFrame(list: ChimeIn[], frameSlug: string): ChimeIn[] {
  return list.map((c) =>
    c.status === "pending" && c.frameSlug === frameSlug
      ? { ...c, status: "dismissed" as const }
      : c,
  );
}

export function dismissChimeIn(list: ChimeIn[], id: string): ChimeIn[] {
  return list.map((c) => (c.id === id ? { ...c, status: "dismissed" as const } : c));
}

export function applyChimeIn(list: ChimeIn[], id: string): ChimeIn[] {
  return list.map((c) => (c.id === id ? { ...c, status: "applied" as const } : c));
}

export function pendingObjections(list: ChimeIn[]): string[] {
  return list.filter((c) => c.status === "pending").map((c) => c.objection);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/chimeIns.test.ts`
Expected: PASS (8 tests: 2 from Task 1 + 6 here).

- [ ] **Step 5: Commit**

```bash
git add studio/server/chimeIns.ts studio/__tests__/server/chimeIns.test.ts
git commit -m "feat(studio/computer): chime-in list transforms (add/dedup/stale/dismiss)"
```

---

## Task 4: Drift-check response parser + runner

**Files:**
- Create: `studio/server/devrev/driftCheck.ts`
- Test: `studio/__tests__/server/devrev/driftCheck.test.ts`

`parseDriftResponse` is pure. `runDriftCheck` wires `buildComputerContext` → `runComputerTurn` → parse → persist; the test mocks `runComputerTurn` and the project IO so no network runs.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/devrev/driftCheck.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { parseDriftResponse, DRIFT_CHECK_INSTRUCTION } from "../../../server/devrev/driftCheck";

describe("parseDriftResponse", () => {
  it("returns null for an exact NONE", () => {
    expect(parseDriftResponse("NONE")).toBeNull();
  });
  it("returns null for NONE with whitespace/case noise", () => {
    expect(parseDriftResponse("  none  ")).toBeNull();
    expect(parseDriftResponse("None.")).toBeNull();
  });
  it("returns null for empty/blank", () => {
    expect(parseDriftResponse("")).toBeNull();
    expect(parseDriftResponse("   ")).toBeNull();
  });
  it("returns the objection text for a real concern", () => {
    const obj = parseDriftResponse("Tickets don't auto-close when assigned in DevRev.");
    expect(obj).toBe("Tickets don't auto-close when assigned in DevRev.");
  });
  it("instruction tells the agent to default to silence", () => {
    expect(DRIFT_CHECK_INSTRUCTION).toMatch(/NONE/);
    expect(DRIFT_CHECK_INSTRUCTION.toLowerCase()).toContain("only if");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/devrev/driftCheck.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parser + runner**

Create `studio/server/devrev/driftCheck.ts`:

```ts
import { randomUUID } from "node:crypto";
import { runComputerTurn } from "./computerAgent";
import { buildComputerContext } from "./computerContext";
import { addChimeIn, pendingObjections } from "../chimeIns";
import { getProject, updateProject, readHistory } from "../projects";

/**
 * Silent product-truth watcher. After the code agent writes a frame, we ask
 * the Computer (DevRev agent/620) whether the prototype drifts from how
 * DevRev actually works — judged on its general product knowledge, NOT live
 * org data (which it fabricates). The instruction biases hard toward silence:
 * a "looks fine" is never surfaced.
 */
export const DRIFT_CHECK_INSTRUCTION =
  "You silently watch this DevRev prototype for product-truth drift. " +
  "Using only your general knowledge of how DevRev works as a product " +
  "(objects, workflows, user roles) — NOT any live org data — decide if the " +
  "current frame contradicts real DevRev behavior. Respond ONLY if you have a " +
  "specific, concrete objection, in one or two sentences. If the frame is fine, " +
  "plausible, or you are unsure, respond with exactly NONE and nothing else.";

/** Returns the objection text, or null when the agent declined to chime in. */
export function parseDriftResponse(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Treat a bare "NONE" (any case, optional trailing punctuation) as silence.
  if (/^none[.!\s]*$/i.test(trimmed)) return null;
  return trimmed;
}

export interface RunDriftCheckDeps {
  /** Pre-rendered frame source block, e.g. from readFrameSources(slug). */
  frameSource: string;
  /** Frame slug the chime-in is about (the changed frame). */
  frameSlug: string;
}

/**
 * Fire-and-forget: never throws. Builds context, calls Computer, persists a
 * chime-in if there's a real objection. Failures are logged and dropped — a
 * background watcher must never nag.
 */
export async function runDriftCheck(slug: string, deps: RunDriftCheckDeps): Promise<void> {
  try {
    const project = await getProject(slug);
    if (!project) return;

    const history = await readHistory(slug);
    const recentHistory = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));

    const context = buildComputerContext({
      projectSummary: `Project: ${project.name} (theme: ${project.theme}).`,
      pendingChimeIns: pendingObjections(project.chimeIns ?? []),
      frameSource: deps.frameSource,
      recentHistory,
    });

    let assistantText = "";
    const result = await runComputerTurn({
      prompt: `${DRIFT_CHECK_INSTRUCTION}\n\n---\n${context}`,
      conversationId: project.computerConversationId,
      timeoutMs: 60_000,
      onEvent: (ev) => {
        if (ev.kind === "narration") assistantText = ev.text;
      },
    });

    const objection = parseDriftResponse(result.assistantText || assistantText);
    if (!objection) return;

    const fresh = await getProject(slug);
    if (!fresh) return;
    const nextList = addChimeIn(fresh.chimeIns ?? [], {
      id: `ci-${randomUUID()}`,
      frameSlug: deps.frameSlug,
      objection,
      createdAt: new Date().toISOString(),
    });
    // addChimeIn dedups; only persist when the list actually grew.
    if (nextList.length !== (fresh.chimeIns ?? []).length) {
      await updateProject(slug, { chimeIns: nextList });
    }
  } catch (err) {
    console.warn(`[studio] drift check failed for ${slug}:`, err);
  }
}
```

> Note: `new Date()` / `randomUUID()` are fine in runtime middleware here — the no-`Date.now()` rule applies only to Workflow scripts, not to studio server code.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/devrev/driftCheck.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/server/devrev/driftCheck.ts studio/__tests__/server/devrev/driftCheck.test.ts
git commit -m "feat(studio/computer): drift-check runner + NONE-biased response parser"
```

---

## Task 5: Wire context into the manual @Computer summon

**Files:**
- Modify: `studio/server/middleware/chat.ts:657-718` (`runComputerBranch`)
- Test: covered by manual run (Step 5) — `runComputerBranch` is IO-heavy glue; the pure pieces are already tested in Tasks 2-4.

- [ ] **Step 1: Add imports**

At the top of `studio/server/middleware/chat.ts`, with the other `../devrev/...` / `../projects` imports:

```ts
import { buildComputerContext } from "../devrev/computerContext";
import { pendingObjections } from "../chimeIns";
import { readHistory } from "../projects";
```

(`readHistory` may already be importable from `../projects`; add it to the existing import if so rather than duplicating.)

- [ ] **Step 2: Build and prepend context in `runComputerBranch`**

In `runComputerBranch`, the `project` param type is `{ computerConversationId?: string }`. Widen it to also carry what we need:

```ts
async function runComputerBranch(ctx: {
  emit: (ev: StudioEvent) => void;
  slug: string;
  prompt: string;
  project: { name?: string; theme?: string; computerConversationId?: string; chimeIns?: import("../types").ChimeIn[] };
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
```

Replace the block that currently computes `finalPrompt` (the `let finalPrompt = cleaned; if (wantsFrameContext) {...}` section at `chat.ts:676-682`) with:

```ts
  // Build full project context for the summon: project summary + pending
  // chime-ins + current frame source + recent chat history. The #frame
  // trigger is now redundant for the in-view frames (always included) but
  // we keep reading sources unconditionally so Computer always sees them.
  const frameSource = await readFrameSources(slug);
  const history = await readHistory(slug);
  const recentHistory = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  const context = buildComputerContext({
    projectSummary: `Project: ${project.name ?? slug} (theme: ${project.theme ?? "arcade"}).`,
    pendingChimeIns: pendingObjections(project.chimeIns ?? []),
    frameSource,
    recentHistory,
  });
  const finalPrompt = `${context}\n\n---\n${cleaned}`;
```

Remove the now-unused `wantsFrameContext` variable and the `FRAME_TRIGGER.test(prompt)` line if nothing else reads it. (Leave `FRAME_TRIGGER_GLOBAL` stripping in the `cleaned` computation intact so a typed `#frame` is still cleaned out of the visible prompt.)

- [ ] **Step 3: Pass the full project into `runComputerBranch`**

At the dispatch site (`chat.ts:217-219`), `runComputerBranch` is called with `{ ..., project, ... }` where `project` is the full loaded `Project`. Confirm the full `project` object (which now has `name`, `theme`, `chimeIns`) is passed — it already is (`handleStart` loads `project` at `chat.ts:120`). No change needed beyond the widened type in Step 2.

- [ ] **Step 4: Restart and manually verify**

```bash
pnpm run studio
```

In a project with at least one frame, type `@Computer does this screen match how DevRev works?` and confirm Computer's reply reflects the actual frame/project (not a generic answer). Set `STUDIO_DEBUG_COMPUTER=1` to log `promptChars` and confirm the payload grew but stays well under 50KB.

- [ ] **Step 5: Run the full suite + commit**

Run: `pnpm run studio:test`
Expected: PASS (no regressions).

```bash
git add studio/server/middleware/chat.ts
git commit -m "feat(studio/chat): give @Computer full project context on summon"
```

---

## Task 6: Trigger the silent drift check after frame-writing turns

**Files:**
- Modify: `studio/server/middleware/chat.ts` (`runClaudeBranch`, the success branch around `chat.ts:629-636`)

`runClaudeBranch` already computes `afterSnapshot` + `diff` at `chat.ts:630-631` when `joined` is truthy. We reuse that diff to (a) mark stale chime-ins for changed frames and (b) fire the drift check on the changed frame.

- [ ] **Step 1: Add imports**

With the other imports in `chat.ts`:

```ts
import { runDriftCheck } from "../devrev/driftCheck";
import { markStaleByFrame } from "../chimeIns";
```

- [ ] **Step 2: Derive the changed frame slug + fire the check**

In `runClaudeBranch`, inside `if (joined) { ... }` (currently `chat.ts:629-636`), AFTER the existing `if (!hasAnyChange(diff)) {...}` block, add:

```ts
      // A frame changed this turn — (1) stale-dismiss any pending chime-ins
      // about it (the objection may no longer apply) and (2) fire a silent
      // background drift check. Both are best-effort and never block the turn.
      const changedFrame = frameSlugFromDiff(diff);
      if (changedFrame) {
        try {
          const current = await getProject(slug);
          if (current) {
            const staled = markStaleByFrame(current.chimeIns ?? [], changedFrame);
            if (JSON.stringify(staled) !== JSON.stringify(current.chimeIns ?? [])) {
              await updateProject(slug, { chimeIns: staled });
            }
          }
        } catch (err) {
          console.warn(`[studio] stale-dismiss failed for ${slug}:`, err);
        }

        // Fire-and-forget: do not await. The turn ends; the chime-in (if any)
        // shows up a few seconds later via the chime-ins poll.
        void readFrameSources(slug).then((frameSource) =>
          runDriftCheck(slug, { frameSource, frameSlug: changedFrame }),
        );
      }
```

- [ ] **Step 3: Add the `frameSlugFromDiff` helper**

Near `readFrameSources` at the top of `chat.ts`:

```ts
/**
 * Pick the frame slug a snapshot diff is "about". Snapshot keys look like
 * `frames/<slug>/index.tsx` or `shared/...`. We prefer added frames, then
 * changed ones, and only consider paths under `frames/`. Returns null when
 * the diff touched nothing under frames/ (e.g. only shared/ changed).
 */
function frameSlugFromDiff(diff: { added: string[]; changed: string[]; removed: string[] }): string | null {
  const pick = (paths: string[]): string | null => {
    for (const p of paths) {
      const m = p.match(/^frames\/([^/]+)\//);
      if (m) return m[1];
    }
    return null;
  };
  return pick(diff.added) ?? pick(diff.changed);
}
```

- [ ] **Step 4: Add a unit test for the helper**

Create `studio/__tests__/server/chat-frame-slug-from-diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { frameSlugFromDiff } from "../../server/middleware/chat";

describe("frameSlugFromDiff", () => {
  it("prefers an added frame", () => {
    expect(
      frameSlugFromDiff({ added: ["frames/02-new/index.tsx"], changed: ["frames/01-old/index.tsx"], removed: [] }),
    ).toBe("02-new");
  });
  it("falls back to a changed frame", () => {
    expect(
      frameSlugFromDiff({ added: [], changed: ["frames/01-old/index.tsx"], removed: [] }),
    ).toBe("01-old");
  });
  it("ignores non-frame paths", () => {
    expect(frameSlugFromDiff({ added: ["shared/util.ts"], changed: [], removed: [] })).toBeNull();
  });
});
```

For this to work, export the helper: change `function frameSlugFromDiff` to `export function frameSlugFromDiff`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/chat-frame-slug-from-diff.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Restart + manually verify the background check**

```bash
STUDIO_DEBUG_COMPUTER=1 pnpm run studio
```

Generate a frame whose behavior obviously contradicts DevRev (e.g. "a screen where deleting a ticket also deletes the customer account"). After the Claude turn ends, watch the console for a `[computer-req]` line (the background drift check) and confirm `project.json` gains a `chimeIns` entry. A plausible frame should produce a `NONE` and NO chime-in.

- [ ] **Step 7: Commit**

```bash
git add studio/server/middleware/chat.ts studio/__tests__/server/chat-frame-slug-from-diff.test.ts
git commit -m "feat(studio/chat): fire silent drift check + stale-dismiss after frame turns"
```

---

## Task 7: Chime-in REST endpoints

**Files:**
- Modify: `studio/server/middleware/projects.ts` (add routes near the `/history` route at `:35`)

We add GET (list pending chime-ins) and POST dismiss. Apply is handled client-side by re-sending a normal chat prompt, then POSTing apply to flip status — see Task 9.

- [ ] **Step 1: Add imports**

At the top of `studio/server/middleware/projects.ts`, ensure these are imported (extend existing import lines):

```ts
import { getProject, updateProject } from "../projects";
import { dismissChimeIn, applyChimeIn } from "../chimeIns";
```

- [ ] **Step 2: Add the routes**

Immediately after the `histMatch` block (`projects.ts:37`):

```ts
      const chimeListMatch = url
        .replace(/\?.*$/, "")
        .match(/^\/api\/projects\/([a-z0-9-]+)\/chime-ins$/);
      if (req.method === "GET" && chimeListMatch) {
        const p = await getProject(chimeListMatch[1]);
        const pending = (p?.chimeIns ?? []).filter((c) => c.status === "pending");
        return send(res, 200, pending);
      }

      const chimeActionMatch = url
        .replace(/\?.*$/, "")
        .match(/^\/api\/projects\/([a-z0-9-]+)\/chime-ins\/([a-z0-9-]+)\/(dismiss|apply)$/);
      if (req.method === "POST" && chimeActionMatch) {
        const [, slug, id, action] = chimeActionMatch;
        const p = await getProject(slug);
        if (!p) return send(res, 404, { error: { code: "not_found", message: "Project not found" } });
        const next = action === "dismiss"
          ? dismissChimeIn(p.chimeIns ?? [], id)
          : applyChimeIn(p.chimeIns ?? [], id);
        await updateProject(slug, { chimeIns: next });
        return send(res, 204);
      }
```

(Match the exact `send(...)` helper signature already used in this file — verify `send(res, 204)` with no body is valid; if the helper requires a body arg, pass `send(res, 200, { ok: true })` instead.)

- [ ] **Step 3: Add an endpoint test**

Create `studio/__tests__/server/middleware/chime-ins-routes.test.ts` mirroring the style of the existing `__tests__/server/middleware/` tests (inspect a sibling for the exact harness — they typically build a fake `req`/`res` and assert status + JSON). Minimum coverage:

```ts
// Verify GET returns only pending chime-ins and POST dismiss flips status.
// Use the same in-memory project fixture helper the sibling middleware
// tests use (e.g. a tmp projects root + createProject), then call the
// middleware with a synthetic req/res.
```

Write concrete assertions following the sibling test's harness (do NOT leave this as prose — read one sibling file first, copy its setup, assert: GET `/api/projects/<slug>/chime-ins` returns `[]` initially; after seeding a pending chime-in via `updateProject`, GET returns 1 item; POST `.../<id>/dismiss` → 204 and a subsequent GET returns `[]`).

- [ ] **Step 4: Run the test**

Run: `pnpm run studio:test __tests__/server/middleware/chime-ins-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/projects.ts studio/__tests__/server/middleware/chime-ins-routes.test.ts
git commit -m "feat(studio/api): chime-in list + dismiss/apply endpoints"
```

---

## Task 8: ChimeInNote component

**Files:**
- Create: `studio/src/components/chat/computer/ChimeInNote.tsx`
- Test: `studio/__tests__/components/chat/chime-in-note.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/chat/chime-in-note.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const Computer: any = () => React.createElement("span", { "data-testid": "computer-icon" });
  return { Computer };
});

import { ChimeInNote } from "../../../src/components/chat/computer/ChimeInNote";

afterEach(() => cleanup());

const chime = {
  id: "ci-1",
  frameSlug: "01-x",
  objection: "Tickets don't auto-close when assigned in DevRev.",
  createdAt: "t",
  status: "pending" as const,
};

describe("ChimeInNote", () => {
  it("shows the objection's first line collapsed", () => {
    const { getByText } = render(
      <ChimeInNote chime={chime} onApply={() => {}} onDismiss={() => {}} />,
    );
    expect(getByText(/Computer noticed something/i)).toBeTruthy();
  });

  it("fires onApply and onDismiss", () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <ChimeInNote chime={chime} onApply={onApply} onDismiss={onDismiss} />,
    );
    fireEvent.click(getByRole("button", { name: /apply/i }));
    fireEvent.click(getByRole("button", { name: /dismiss/i }));
    expect(onApply).toHaveBeenCalledWith(chime);
    expect(onDismiss).toHaveBeenCalledWith(chime);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/chat/chime-in-note.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

Create `studio/src/components/chat/computer/ChimeInNote.tsx`:

```tsx
import { useState } from "react";
import { Computer } from "@xorkavi/arcade-gen";
import type { ChimeIn } from "../../../../server/types";

/**
 * Inline, low-intrusion note rendered under the code-agent turn that
 * triggered it. Collapsed by default: one line summarizing Computer's
 * product-truth objection. Expands to the full text. Apply re-prompts the
 * code agent with the objection; Dismiss hides it.
 */
export function ChimeInNote({
  chime,
  onApply,
  onDismiss,
}: {
  chime: ChimeIn;
  onApply: (c: ChimeIn) => void;
  onDismiss: (c: ChimeIn) => void;
}) {
  const [open, setOpen] = useState(false);
  const firstLine = chime.objection.split("\n")[0];

  return (
    <div
      data-testid="chime-in-note"
      style={{
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 8,
        background: "var(--surface-shallow)",
        padding: "8px 10px",
        fontSize: 13,
        color: "var(--fg-neutral-medium)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          font: "inherit",
        }}
      >
        <span aria-hidden style={{ flexShrink: 0, display: "flex" }}>
          <Computer size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: open ? "normal" : "nowrap" }}>
          {open ? chime.objection : `Computer noticed something — ${firstLine}`}
        </span>
        <span aria-hidden style={{ opacity: 0.5, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
      </button>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onApply(chime)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--stroke-accent-subtle, var(--stroke-neutral-subtle))",
            background: "var(--bg-accent-subtle, transparent)",
            color: "var(--fg-accent-prominent)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => onDismiss(chime)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--stroke-neutral-subtle)",
            background: "transparent",
            color: "var(--fg-neutral-medium)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/chat/chime-in-note.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/chat/computer/ChimeInNote.tsx studio/__tests__/components/chat/chime-in-note.test.tsx
git commit -m "feat(studio/chat): ChimeInNote inline collapsed-note component"
```

---

## Task 9: Render chime-ins + wire Apply/Dismiss end to end

**Files:**
- Modify: `studio/src/components/chat/MessageList.tsx` (render notes after history)
- Modify: `studio/src/components/chat/ChatPane.tsx` (accept `chimeIns` + handlers)
- Modify: `studio/src/routes/ProjectDetail.tsx` (fetch chime-ins, define handlers)

- [ ] **Step 1: Accept chime-ins in MessageList**

In `MessageList.tsx`, add to the props type (after `turnEndedAt`):

```ts
  chimeIns?: import("../../../server/types").ChimeIn[];
  onApplyChimeIn?: (c: import("../../../server/types").ChimeIn) => void;
  onDismissChimeIn?: (c: import("../../../server/types").ChimeIn) => void;
```

Add to the destructured params:

```ts
  chimeIns = [],
  onApplyChimeIn,
  onDismissChimeIn,
```

Import the note at the top:

```ts
import { ChimeInNote } from "./computer/ChimeInNote";
```

Render the pending notes right AFTER the `history.map(...)` block and before `{pendingPrompt && ...}` (around `MessageList.tsx:276`):

```tsx
      {chimeIns
        .filter((c) => c.status === "pending")
        .map((c) => (
          <ChimeInNote
            key={c.id}
            chime={c}
            onApply={(x) => onApplyChimeIn?.(x)}
            onDismiss={(x) => onDismissChimeIn?.(x)}
          />
        ))}
```

- [ ] **Step 2: Thread through ChatPane**

In `ChatPane.tsx`, add to the props type:

```ts
  chimeIns?: import("../../../server/types").ChimeIn[];
  onApplyChimeIn?: (c: import("../../../server/types").ChimeIn) => void;
  onDismissChimeIn?: (c: import("../../../server/types").ChimeIn) => void;
```

Destructure them and pass into `<MessageList ... />`:

```tsx
        chimeIns={chimeIns}
        onApplyChimeIn={onApplyChimeIn}
        onDismissChimeIn={onDismissChimeIn}
```

- [ ] **Step 3: Fetch chime-ins + define handlers in ProjectDetail**

In `studio/src/routes/ProjectDetail.tsx`, near where `ChatPane` is mounted (`:454`), add state + a fetcher. Mirror the existing history-refresh pattern (poll on turn end + the `arcade-studio:refresh-chat-history` event):

```tsx
  const [chimeIns, setChimeIns] = useState<ChimeIn[]>([]);

  const refreshChimeIns = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${slug}/chime-ins`);
      if (r.ok) setChimeIns(await r.json());
    } catch { /* best-effort */ }
  }, [slug]);

  // Poll while idle so a background drift check (which lands a few seconds
  // after the turn ends) surfaces without a manual refresh.
  useEffect(() => {
    void refreshChimeIns();
    const id = window.setInterval(() => void refreshChimeIns(), 5000);
    return () => window.clearInterval(id);
  }, [refreshChimeIns]);

  const handleApplyChimeIn = useCallback(async (c: ChimeIn) => {
    await fetch(`/api/projects/${slug}/chime-ins/${c.id}/apply`, { method: "POST" });
    setChimeIns((list) => list.filter((x) => x.id !== c.id));
    // Re-prompt the code agent with Computer's objection.
    source.send?.(`Computer flagged a product-truth issue: ${c.objection}. Please adjust the frame to match how DevRev actually works.`);
  }, [slug, source]);

  const handleDismissChimeIn = useCallback(async (c: ChimeIn) => {
    await fetch(`/api/projects/${slug}/chime-ins/${c.id}/dismiss`, { method: "POST" });
    setChimeIns((list) => list.filter((x) => x.id !== c.id));
  }, [slug]);
```

Add the `ChimeIn` type import:

```ts
import type { ChimeIn } from "../../server/types";
```

(Adjust the relative import depth to match `ProjectDetail.tsx`'s location, and reuse the existing `slug` + send accessor — in this file the host source is available; use whatever local name holds `useProjectFromHost(...)`'s return. If `send` is exposed directly rather than via `source.send`, call that instead.)

Pass to `<ChatPane>`:

```tsx
            chimeIns={chimeIns}
            onApplyChimeIn={handleApplyChimeIn}
            onDismissChimeIn={handleDismissChimeIn}
```

- [ ] **Step 4: Run the component suite**

Run: `pnpm run studio:test __tests__/components/chat/`
Expected: PASS (existing + new chime-in tests; no regressions in messageList-journey).

- [ ] **Step 5: Restart + manual end-to-end verification**

```bash
pnpm run studio
```

1. Generate a frame that clearly contradicts DevRev product behavior.
2. Within ~5-10s of the turn ending, a collapsed "Computer noticed something — …" note appears under the turn.
3. Click it → expands to the full objection.
4. Click **Apply** → note disappears, a new code-agent turn starts with the objection as the prompt.
5. Generate a fresh, plausible frame → confirm NO note appears (silent on `NONE`).
6. Raise a note, then edit that same frame again → confirm the note auto-dismisses (staleness).

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/chat/MessageList.tsx studio/src/components/chat/ChatPane.tsx studio/src/routes/ProjectDetail.tsx
git commit -m "feat(studio/chat): render chime-in notes with Apply/Dismiss wiring"
```

---

## Task 10: Full suite + final verification

- [ ] **Step 1: Run the whole suite**

Run: `pnpm run studio:test`
Expected: PASS — all prior tests plus the new ones (~173 + new).

- [ ] **Step 2: Confirm the no-DevRev-PAT path is graceful**

With no DevRev PAT configured, the drift check's `runComputerTurn` emits an `end:{ok:false}` (see `computerAgent.ts:52-59`); `runDriftCheck` swallows it (no chime-in, logged). Verify the app still works end to end (Claude turns unaffected) when the PAT is absent.

- [ ] **Step 3: Final commit if any cleanup**

```bash
git add -p   # stage reviewed hunks only — never git add -A in this repo
git commit -m "chore(studio/computer): cleanup after context-aware co-pilot"
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** context builder (Task 2), summon context all-four-sources (Task 5 + builder), silent per-generation drift check with NONE bias (Tasks 4, 6), dedup (Task 3 `addChimeIn`), staleness (Task 3 `markStaleByFrame` + Task 6 trigger), inline collapsed note (Task 8), Apply/Dismiss (Tasks 7, 9), error handling fire-and-forget (Task 4 try/catch, Task 6 `void`), 50KB cap (Task 2 budget + clamp). All scope cuts honored (no live-data, no Discuss, no auto-apply, no reviewed-✓ marker, no batch).
- **Type consistency:** `ChimeIn` fields (`id`, `frameSlug`, `objection`, `createdAt`, `status`) identical across types.ts, chimeIns.ts, driftCheck.ts, endpoints, component. Helper names stable: `addChimeIn`, `dismissChimeIn`, `applyChimeIn`, `markStaleByFrame`, `pendingObjections`, `buildComputerContext`, `parseDriftResponse`, `runDriftCheck`, `frameSlugFromDiff`.
- **Restart reminder:** Tasks 5/6/7 touch middleware — full `pnpm run studio` restart required before manual verification (no hot reload).
