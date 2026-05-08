# Multi-frame flows

**Status:** design
**Date:** 2026-05-08
**Scope:** `studio/`

## The problem

Beta feedback from a user who built a four-step flow:

> "Created a single frame for a 4 step flow — Maybe we just prompt it to always break flow into frames and connect them so users can see all the frames like a design tool."

Three root causes, each cheap to fix:

1. **The agent never mentions flows.** `studio/templates/CLAUDE.md.tpl` talks about "a frame" as a singular unit. Multi-frame generation is possible (the filesystem supports it, and the agent naming hint lists `01-welcome`, `02-signup`, …), but nothing tells the agent to *propose* a split when the prompt describes a flow. The agent defaults to cramming everything into one frame.
2. **The viewport has no "new frame" affordance.** Users don't discover that multiple frames are possible.
3. **The agent never proactively suggests splitting**, even when the prompt obviously describes a flow ("4-step onboarding").

This spec addresses all three, in that order. The first is the biggest win; the other two close the loop for discoverability.

## Out of scope

- **Connectors / arrows between frames.** Connectors only carry meaning when a human draws them to express a known transition. Auto-drawn arrows would either be wrong (not every adjacent pair is a flow step) or fabricate relationships the agent assumed. Revisit if users ask for this after shipping.
- **A "flow" data model.** No new field on `Project` or `Frame`. Frames remain an array ordered by slug (two-digit prefix is the ordering convention).
- **Server-side flow detection.** The agent decides what's a flow; no TypeScript keyword matching.
- **Frame reorder / rename / delete UI.** Out of scope for this round. Rename is agent-driven ("rename frame 2 to signup"). Deletion is agent-driven ("delete frame 2") or via the filesystem. If blank-frame clutter becomes a problem post-ship, we'll add a `⋯` menu — but not preemptively.
- **Undo for the split.** Users redirect via the next chat turn ("merge these back into one", "just keep the first").

## Design

Three coordinated changes:

### A. Agent teaches itself flows

Update `studio/templates/CLAUDE.md.tpl` with a new top-level section, **"When the prompt describes a flow"**, placed as a sibling of the existing "Responsive design (required for every frame)" section. The content:

**Detection rule.** The agent treats a prompt as flow-shaped when it contains any of:
- Explicit step language: "4-step flow", "step 1 … step 2 …", "a wizard", "an onboarding flow", "walk the user through", "checkout flow".
- Enumerated states that imply separate screens: "signup → verify email → welcome", "empty state / loading / error / success".
- A verb chain describing a user journey: "user lands, picks a plan, enters payment, confirms".

The agent treats a prompt as **not** flow-shaped when it is:
- Single-screen: "a settings page", "a dashboard", "a login screen".
- Component-level: "a button", "a modal".
- Iteration on an existing frame: "make the header bigger", "change the copy".

When unsure, the agent builds one frame and mentions that splitting is an option in its response (so the user can redirect with a follow-up turn). Over-detection is worse than under-detection — an unexpected split costs the user a turn to undo.

**Response shape when flow is detected.** The agent does *not* build anything on the detection turn. It replies with:

> "This looks like a 4-step onboarding flow: welcome → signup → verify email → done. Want me to build each step as its own frame so you can see the whole flow side by side, or all in one frame?"

Two sentences, always enumerates the steps it inferred (so the user can react concretely — "yes, but drop the verify step"), always offers both paths. No frame file written, no `### Deviations` section (the response describes no build).

**Response shape when user confirms split.** Agent produces all N frames in a single turn, named with two-digit prefixes in flow order (`01-welcome`, `02-signup`, `03-verify`, `04-done`). Frames are written sequentially; the Vite file watcher picks each one up as it lands, so the user sees them appear progressively in the viewport. A single `### Deviations` section covers the batch, with one bullet per frame that deviated.

**Response shape when user declines split.** Agent builds one frame, normal response shape.

**Mid-project flow prompts.** If the project already has frames and the user prompts for a flow that extends them ("add a confirmation step"), the agent creates frames only for the new steps, numbered after the existing ones. No ask-first on extensions — the user has already committed to multiple frames.

**Frame-targeted prompts.** When a prompt names a specific frame (e.g. "Design the Untitled 1 screen: a signup form with email + password"), the agent edits only that frame's `index.tsx`. It does not create new frames, rename existing ones, or modify unrelated frames. This rule makes the "+ New frame" button's seed text (Section B) route correctly.

Rough size: ~40 lines of template prose, including examples. No code in the template — only instructions to the agent.

### B. Viewport "+ New frame" affordance

**UI surfaces.**

*Row-end card in `Viewport.tsx`.* When the project has ≥ 1 frame, a compact placeholder card appears at the end of the horizontal frame row. It matches the visual weight of a `FrameCard` but shorter: a dashed-border box containing a `+` icon and the label "New frame". Clicking it invokes the click flow below. The card sits inside the same flex row as the frames, using the existing `gap: 64` spacing from [studio/src/components/viewport/Viewport.tsx:54-76](studio/src/components/viewport/Viewport.tsx#L54-L76).

*Empty-state option in `EmptyViewport.tsx`.* The current component is effectively blank. Add a "+ New frame" option as a secondary path alongside the implicit primary path ("type in chat"). Copy: "Start with a blank frame". Same click flow.

**Click flow.**

1. Client sends `POST /api/frames/:slug` with no body (or optional `{ name?: string }`).
2. Server creates a new frame directory at `projects/<slug>/frames/<NN>-untitled-<M>/index.tsx`:
   - `NN` is the next available two-digit prefix (`01`, `02`, …) by scanning all existing frame slugs.
   - `<M>` is the lowest positive integer not already used by an `untitled-*` frame in this project — so the first blank frame is `untitled-1`, the second is `untitled-2`. If the user deletes `untitled-1`, the next click reuses `-1`.
   - Example: project has `01-home` and `02-settings`. First click creates `03-untitled-1`. Second click (without deletion) creates `04-untitled-2`.
3. Server writes a minimal scaffold into `index.tsx` (see below).
4. Server calls the existing `rescanFrames` flow in [studio/server/projects.ts:343-377](studio/server/projects.ts#L343) so the project's frame array and file watcher pick it up.
5. Server returns the created `Frame` object.
6. Client scrolls the viewport horizontally so the new frame is visible, then focuses the chat input with seed text: `"Design the Untitled 1 screen: "` (with the cursor at the end). The user completes the sentence and sends.

**Scaffold contents.** The `index.tsx` for a blank frame:

```tsx
export default function UntitledFrame() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center text-[var(--fg-neutral-subtle)]">
        This frame is blank. Describe it in the chat to bring it to life.
      </div>
    </div>
  );
}
```

Two goals: the empty state is visibly intentional (not a crash), and it uses the same token + closed-world import conventions the agent follows, so overwriting it later doesn't introduce stylistic drift.

**Server endpoint.** New middleware file `studio/server/middleware/frames.ts`, mounted in `vite.config.ts` with the other middleware. Single route: `POST /api/frames/:slug`. Behavior outlined above. Validates slug against the existing slug regex; returns 400 on bad slug, 404 on unknown project, 201 on success with the created `Frame` payload.

Why a dedicated middleware rather than extending `projects.ts`: frames are a sub-resource of projects and projects.ts is already dense (400+ lines). A one-responsibility middleware is clearer and cheaper to test.

### C. Proactive suggestion

Section A already implements this. The agent's detection rule fires regardless of whether the user asked for the split — so a user typing "4-step onboarding" on a fresh project gets the suggestion on the first turn. No additional code path.

Why not a UI-level banner or toast: classification needs prompt understanding. A client-side keyword matcher would be brittle; a round-trip to the agent for classification alone would be expensive. Making the agent's first response *be* the suggestion uses the strongest available signal for free.

## Success criteria

**Agent splits a flow prompt.** Fresh project, user types "Build a 4-step onboarding: welcome, signup, verify email, done":
1. Agent's first response is the enumeration + "split or combine?" question. No frame file is written.
2. User replies "yes, split" (or equivalent).
3. Four frames appear in the viewport (`01-welcome`, `02-signup`, `03-verify-email`, `04-done`), each renderable at all five device widths.
4. Chat shows one summary + one `### Deviations` section covering the batch.

**User creates a frame from the UI.** Existing project with one frame (`01-home`):
1. User clicks "+ New frame" at the end of the frame row.
2. A new frame `02-untitled-1` (display name "Untitled 1") appears in the viewport with the placeholder message.
3. The chat input is focused with "Design the Untitled 1 screen: " pre-filled.
4. User completes the prompt ("a settings page with two toggles") and sends.
5. Agent writes to `02-untitled-1/index.tsx` only — no other frame is touched, no new frames are created.

**Under-detection works gracefully.** User types a prompt the agent doesn't recognize as a flow ("an app that lets users track gym visits"):
1. Agent builds one frame.
2. Response ends with a one-sentence note: e.g. "If you'd like this split across frames (a home, a log-visit screen, a history screen), let me know."

## Risks

1. **Over-detection.** "A dashboard with three tabs" is not a flow, but contains enumeration. The template's negative signals (component-level and single-screen cues) should catch this; beta feedback will tune the detection rule further.
2. **Blank-frame clutter.** The placeholder scaffold is visibly empty, so users don't mistake it for a crash. If abandonment becomes a real pattern, we add a `⋯` menu with "Delete frame" — but not in this round.
3. **Seed text routes to the wrong frame.** Handled by the frame-targeted prompt rule in Section A: when a prompt names a frame by display name, the agent edits only that frame.
4. **Multi-frame generation is slow.** A 4-frame turn is ~4× the latency of a 1-frame turn (6–10 minutes on Bedrock). The existing turn status row already handles long-running turns. Worth watching for timeouts in telemetry; no preemptive changes.

## Files touched (approximate)

- `studio/templates/CLAUDE.md.tpl` — new "When the prompt describes a flow" section (~40 lines), updated frame-targeting rule.
- `studio/server/middleware/frames.ts` — new file, `POST /api/frames/:slug`.
- `studio/vite.config.ts` — mount the new middleware.
- `studio/server/projects.ts` — export a helper for "next available frame prefix" (or inline the logic in the new middleware and keep projects.ts untouched — decided in the plan).
- `studio/src/components/viewport/Viewport.tsx` — render the "+ New frame" card at the row end.
- `studio/src/components/viewport/EmptyViewport.tsx` — add the "+ New frame" secondary option.
- `studio/src/components/chat/PromptInput.tsx` — accept a "seed with text + focus" imperative (likely through an existing ref or context; to be determined during planning).
- `studio/src/lib/api.ts` — new `createFrame(slug)` client helper.
- Tests:
  - `studio/__tests__/server/frames.test.ts` — endpoint behavior (creates directory, increments prefix, returns frame).
  - `studio/__tests__/components/viewport-new-frame-card.test.tsx` — click creates and focuses chat.
  - Template-level behavior (ask-first, split-on-confirm) is not unit-testable; verified manually on a beta build.
