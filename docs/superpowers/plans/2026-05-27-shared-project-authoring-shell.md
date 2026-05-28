# Shared Project Uses Authoring Shell — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke `SharedProject.tsx` view with the same authoring UI a host sees, so a guest opening a shared project gets identical chrome (header, viewport grid, frame cards, frame detail, comments rail) — minus the affordances that don't make sense for a non-driver (no Generate input, no destructive frame actions).

**Architecture:** `ProjectDetail.tsx` is the host's authoring shell. Most of its visual surface is data-driven from a `Project` (fetched via `/api/projects/:slug`) and chat events (via SSE on `/api/chat/:slug/stream`). The shared-project route fetches the *same* shape from `/api/shared-projects/:id` (mirror cache + relay) and routes that into the SAME components, gated by a `readonly` mode prop. This keeps a single visual/interaction surface for both host and guest, and lets us delete `SharedProject.tsx` entirely.

**Tech Stack:** React 19 + Vite, the same component tree we already ship in `studio/src/components/{shell,viewport,chat}`, plus a thin adapter that maps mirror events → the shape `ChatPane`/`Viewport` expect.

---

## File Structure

- `studio/src/routes/ProjectDetail.tsx` — accept a `mode: "author" | "spectator"` prop. Author = today's behavior. Spectator = render the same layout but disable input affordances. Replaces SharedProject.
- `studio/src/routes/SharedProject.tsx` — **delete after migration**. Spec/empty-state/comments-sidebar lives inside the shared shell now.
- `studio/src/hooks/useProjectFromMirror.ts` — **new**. Adapter that fetches `/api/shared-projects/:id` + subscribes to its SSE stream and exposes the same `Project` shape `ProjectDetail` expects today.
- `studio/src/hooks/useProjectFromHost.ts` — **new** (extracted from current ProjectDetail). Today's `/api/projects/:slug` fetch + chat stream wiring, lifted into a hook so the shell can pick the right source.
- `studio/src/components/shell/StudioHeader.tsx` — accept a small `subtitle` slot so the spectator variant can show "Shared by Miha Cuden" without forking the component.
- `studio/src/components/chat/PromptInput.tsx` — accept a `disabled` flag; when true, render the comment-only input the SharedProject route already had (or hide entirely and surface comments through the existing chat flow).
- `studio/src/components/viewport/Viewport.tsx` + `FrameCard.tsx` — accept a `readonly` flag that:
  - hides "New frame" tile
  - hides per-frame delete/duplicate
  - keeps zoom, pan, comments
- `studio/src/App.tsx` (or wherever the route table lives) — point `/shared/:id` at `ProjectDetail` with `mode="spectator"`, drop the SharedProject import.
- `studio/__tests__/components/shared-project-empty-state.test.tsx` — keep, but retarget at `ProjectDetail` in spectator mode.

## Tasks

### Task 1: Inventory ProjectDetail's data dependencies

**Files:**
- Read: `studio/src/routes/ProjectDetail.tsx`
- Read: `studio/src/hooks/useProjectPresence.ts`, `studio/src/hooks/chatStreamContext.tsx`
- Output: `docs/superpowers/scratch/shared-shell-data-deps.md` (working note, not committed)

- [ ] **Step 1:** List every `fetch(...)` and `EventSource(...)` call ProjectDetail (transitively) issues today.
- [ ] **Step 2:** For each one, note (a) URL, (b) shape returned, (c) which child component consumes it. This becomes the "interface" the spectator hook must satisfy.
- [ ] **Step 3:** Cross-check against `/api/shared-projects/:id` and `/api/shared-projects/:id/stream` payloads in `studio/server/middleware/sharedProjects.ts`. List every gap (e.g. presence not mirrored, chat history shape differs).

### Task 2: Extract useProjectFromHost hook

**Files:**
- Create: `studio/src/hooks/useProjectFromHost.ts`
- Modify: `studio/src/routes/ProjectDetail.tsx` — replace inline fetch/stream logic with the hook.
- Test: `studio/__tests__/hooks/useProjectFromHost.test.tsx`

- [ ] **Step 1: Write a failing test** that mounts a component using the hook, mocks `fetch` for `/api/projects/foo`, and asserts the hook exposes `{ project, chatEvents, status }`.
- [ ] **Step 2: Run** `pnpm run studio:test __tests__/hooks/useProjectFromHost.test.tsx` — expect FAIL ("file not found" or "function not exported").
- [ ] **Step 3: Implement** the hook by lifting the fetch + EventSource code from `ProjectDetail.tsx` verbatim, then importing it back.
- [ ] **Step 4: Run** the test → PASS. Run `pnpm run studio:test __tests__/components` to confirm no host-side regressions.
- [ ] **Step 5: Commit:** `refactor(studio/shell): lift project+chat data fetching into useProjectFromHost hook`

### Task 3: Add useProjectFromMirror hook

**Files:**
- Create: `studio/src/hooks/useProjectFromMirror.ts`
- Test: `studio/__tests__/hooks/useProjectFromMirror.test.tsx`

- [ ] **Step 1: Write a failing test** that mocks `/api/shared-projects/p-1` returning `{ metadata, frames: { "frame-01": "<jsx>" }, chat: [...] }` and asserts the hook reshapes that into `{ project: { slug, frames: [...] }, chatEvents: [...], status: "online"|"offline" }` matching the shape `useProjectFromHost` returns.
- [ ] **Step 2: Run** the test — expect FAIL.
- [ ] **Step 3: Implement** the hook. Fetch metadata + frames + chat → translate to `Project` shape → subscribe to `/api/shared-projects/:id/stream` for live updates.
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit:** `feat(studio/shared-projects): add useProjectFromMirror adapter hook`

### Task 4: Add `mode` prop to ProjectDetail

**Files:**
- Modify: `studio/src/routes/ProjectDetail.tsx`
- Test: `studio/__tests__/components/project-detail-spectator-mode.test.tsx`

- [ ] **Step 1: Write a failing test** rendering `<ProjectDetail mode="spectator" id="p-1" />` (with mocked mirror hook) and assert (a) "New frame" tile is absent, (b) PromptInput is hidden or disabled, (c) FrameCard delete affordance is absent.
- [ ] **Step 2: Run** the test → FAIL.
- [ ] **Step 3: Implement.** Add the prop, branch the data hook (`mode === "author" ? useProjectFromHost : useProjectFromMirror`), and thread `readonly={mode === "spectator"}` into Viewport + chat. Don't fork the layout — the same JSX serves both modes.
- [ ] **Step 4: Run** the test → PASS. Run `pnpm run studio:test __tests__/components/project-detail` (whole detail directory) to confirm author mode is unchanged.
- [ ] **Step 5: Commit:** `feat(studio/shell): ProjectDetail spectator mode reuses authoring layout`

### Task 5: Thread readonly through Viewport + FrameCard

**Files:**
- Modify: `studio/src/components/viewport/Viewport.tsx`
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Modify: `studio/src/components/viewport/NewFrameCard.tsx` (return null when readonly)
- Test: `studio/__tests__/components/viewport-readonly.test.tsx`

- [ ] **Step 1: Write a failing test** rendering `<Viewport project={...} readonly />` and asserting (a) `getByText("New frame")` throws, (b) hover on a frame card does not show a delete button.
- [ ] **Step 2: Run** the test → FAIL.
- [ ] **Step 3: Implement.** Add `readonly` prop, gate the destructive UI on it.
- [ ] **Step 4: Run** test → PASS.
- [ ] **Step 5: Commit:** `feat(studio/viewport): readonly mode hides destructive frame affordances`

### Task 6: Disable PromptInput in spectator mode, surface comment-only path

**Files:**
- Modify: `studio/src/components/chat/PromptInput.tsx` (or `ChatPane.tsx`)
- Test: `studio/__tests__/components/prompt-input-readonly.test.tsx`

Decision required during implementation: do we (a) keep PromptInput rendered but `disabled`, with a hint "Only the host can prompt", or (b) replace with a comment-only input (matching today's SharedProject affordance)? Recommend (b) — comments are how guests participate. Implementer should document the decision in the commit message.

- [ ] **Step 1: Write a failing test** rendering `<ChatPane mode="spectator" />` and asserting only a "Comment on this prototype…" input is present, not the prompt textarea.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the chosen approach.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit:** `feat(studio/chat): spectator chat surface posts comments only`

### Task 7: Switch /shared/:id route to ProjectDetail; delete SharedProject.tsx

**Files:**
- Modify: `studio/src/App.tsx` (or wherever the routing happens — confirm during implementation)
- Delete: `studio/src/routes/SharedProject.tsx`
- Modify (retarget): `studio/__tests__/components/shared-project-empty-state.test.tsx` to render `<ProjectDetail mode="spectator" id="p-1" />` and assert the same empty-state copy from inside the spectator shell.

- [ ] **Step 1: Update the route table** to use `<ProjectDetail mode="spectator" id={id} />` for shared projects.
- [ ] **Step 2: Delete** SharedProject.tsx. Run `grep -rn "SharedProject" studio/src` to find lingering imports — there should be none.
- [ ] **Step 3: Update the empty-state test** to mount through the new shell.
- [ ] **Step 4: Run** `pnpm run studio:test` — full suite must pass.
- [ ] **Step 5: Commit:** `refactor(studio/shared-projects): drop bespoke SharedProject view, route through authoring shell in spectator mode`

### Task 8: Manual verification on a beta-tester scenario

**Files:** none (manual)

- [ ] **Step 1:** Run `pnpm run studio` on host machine (or simulate with two profiles). Generate two frames in a project. Share to a second devu via the existing invite flow.
- [ ] **Step 2:** Open the share URL in the second profile. Confirm: (a) viewport grid renders with both frames, (b) header shows "Shared by …", (c) "New frame" tile absent, (d) Comment input present, prompt textarea absent, (e) commenting still posts back via the existing relay.
- [ ] **Step 3:** Quit the host's Studio. Reopen the spectator URL. Confirm: offline banner renders, frames still show from cache, comment input switches to "queued" copy.
- [ ] **Step 4:** Document any rough edges. File issues, do not patch in this plan.

### Task 9: Bump version, changelog, ship

**Files:**
- Modify: `package.json#version` → `0.23.0` (this is a meaningful UX shift, not a patch)
- Modify: `studio/packaging/VERSION` → `0.23.0`
- Modify: `studio/CHANGELOG.md` — add a `## [0.23.0] — YYYY-MM-DD` block.

- [ ] **Step 1: Bump** both version files in lockstep.
- [ ] **Step 2: Add changelog entry** describing the spectator-shell consolidation.
- [ ] **Step 3: Build + manual notarize** following `studio/CLAUDE.md`'s release section.
- [ ] **Step 4: Release on `asundiev-devrev/arcade-studio-releases`** with `unset GITHUB_TOKEN; gh release create v0.23.0 …`.
- [ ] **Step 5: Commit:** `chore(studio): release 0.23.0 — shared projects use authoring shell`

## Risks / Open Questions

- **Mirror data shape vs. `Project` shape mismatch.** ProjectDetail expects a `Project` from `/api/projects/:slug`, which includes things the mirror doesn't (frame ordering metadata, last-prompt timestamps, etc.). Task 1 inventories the gaps; Task 3 fills them. If a field is genuinely missing on the mirror, decide per-field whether to (a) plumb it through the relay, (b) compute it client-side, or (c) hide the dependent UI in spectator mode.
- **Presence in spectator mode.** ProjectDetail's `useProjectPresence` hook talks to the WS multiplayer relay. The mirror's SSE stream already carries presence events from the host's relay — verify the hook can be source-swapped without changing its public shape, or extract a shared `usePresence(eventStream)` primitive.
- **Comment posting path.** SharedProject.tsx today posts to `/api/shared-projects/:id/comment`. ChatPane today posts prompts to `/api/chat/:slug`. The spectator shell needs to keep using the shared-projects path. Task 6 must wire this without breaking host-side comment posts.
- **YAGNI guard:** do **not** introduce a generic "any projection of a project" abstraction. Two concrete data hooks + a `mode` prop is enough. If a third source ever appears, refactor then.
