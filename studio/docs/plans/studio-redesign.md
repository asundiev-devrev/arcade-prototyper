# Studio UI Redesign: Computer Chat App Aesthetic

## Goal

Redesign the Arcade Studio UI to feel like an extended version of the Computer chat app from the DevRev design system. The Studio shell (navigation, chat interface, and project management UI) will adopt Computer's visual language—window chrome, chat composites, and interaction patterns—while maintaining clear visual differentiation from the generated UI that lives inside the iframe viewport. This ensures Studio feels like a cohesive part of the DevRev ecosystem while preventing confusion between the prototyping tool UI and the prototypes themselves.

## Non-goals

- **Don't touch Viewport iframe internals** beyond adding thumbnail capture hooks and the differentiation chrome. The iframe rendering logic, frame switching, and live preview mechanisms remain unchanged.
- **Don't rename components or restructure file hierarchy**. File paths remain stable to minimize merge conflicts.
- **Don't remove Figma middleware/CLI tooling**. The underlying Figma screenshot export infrastructure stays intact. The "From Figma" button is removed from the chat UI; Figma URLs pasted into the chat input are detected and processed inline instead.
- **Don't build custom design tokens**. All styling uses existing arcade tokens from `arcade-gen/src/tokens/generated/`.

**DevModePanel redesign is IN scope.** Rebuild it to mirror the Computer "Canvas" panel (Figma node `167-12277`, compact state `167-11216`, expanded state `167-11331`). When open, DevModePanel **reduces** the viewport's horizontal space — it does not overlay or replace the viewport.

## Target Design

### Before/After Overview

**BEFORE (Current Studio)**

```
┌─────────────────────────────────────────────────────────────────┐
│ [< Projects] • My Project          Dark [☐]  [</>]       Header │ 44px
├──────────┬──────────────────────────────────────────────────────┤
│          │                                                       │
│  Chat    │                                                       │
│  Pane    │                Viewport                              │
│          │              (iframe preview)                        │
│  400px   │                                                       │
│  aside   │                                                       │
│          │                                                       │
│  [chips] │                                                       │
│  textarea│                                                       │
│  button  │                                                       │
└──────────┴──────────────────────────────────────────────────────┘
```

**AFTER (Computer-styled Studio — confirmed layout)**

Top-level decisions (locked):

- **No Computer sidebar nav.** A single header owns project navigation, title, and global actions.
- **Chat is a full-height column on the LEFT.** Standard prototyping-tool pattern; leaves the viewport with maximum space.
- **Header actions (top-right, in order):** Light/dark toggle · Share (Vercel) · Canvas (DevModePanel toggle).
- **No traffic lights, no back/forward arrows.** Clean header only.
- **DevModePanel, when open, REDUCES the viewport column's width** (does not overlay). Styled to mirror Computer's "Canvas" panel.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Studio · My Project ⌄                     [☀/🌙] [Share] [Canvas]  │ 48px header
├─────────────────┬────────────────────────────────────────────────────┤
│                 │                                                    │
│  Agent: I'll    │    ╭──────────────────────────────────────╮       │
│  build a login… │    │  [Generated UI]                      │       │
│                 │    │                                       │       │
│  [Thought ▸]    │    │                                       │       │
│                 │    │                            [Preview]  │       │
│  User: Add…     │    ╰──────────────────────────────────────╯       │
│                 │                                                    │
│                 │                                                    │
├─────────────────┤                                                    │
│ [🖥] Ask…       │                                                    │
│            [+][↑]                                                    │
│  400px          │                                                    │
│  chat column    │              viewport column                       │
└─────────────────┴────────────────────────────────────────────────────┘
```

When DevModePanel (Canvas) is open, the viewport column shrinks:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Studio · My Project ⌄                     [☀/🌙] [Share] [Canvas●] │
├─────────────────┬────────────────────────────┬───────────────────────┤
│                 │                            │                       │
│   chat          │         viewport           │   DevModePanel        │
│   column        │         column             │   (Canvas)            │
│   400px         │         (reduced)          │   320px               │
│                 │                            │                       │
├─────────────────┤                            │                       │
│ [🖥] [+] [↑]    │                            │                       │
└─────────────────┴────────────────────────────┴───────────────────────┘
```

### ASCII Layout: ProjectList (redesigned)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Studio                                    [☀/🌙]  [+ New project]   │ 48px header
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Projects                              [Search 🔍]                  │
│                                                                      │
│   ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐                           │
│   │ SNAP │  │ SNAP │  │ SNAP │  │ SNAP │   ← generated UI snapshots │
│   └──────┘  └──────┘  └──────┘  └──────┘                           │
│   Login     Settings  Dashboard Empty state                          │
│   Apr 20    Apr 19    Apr 18    Apr 17                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Key changes:**
- Header only — no Computer sidebar chrome, no traffic lights, no nav arrows.
- `[+ New project]` lives in the header (right side).
- Theme toggle in the header.
- Replace gradient `placeholderTint()` covers with auto-captured snapshots of the first frame. Fall back to gradient if no snapshot yet exists.
- Cards keep `--surface-shallow` + `--stroke-neutral-subtle`.

### ASCII Layout: ProjectDetail (redesigned — expanded)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Studio · My Project ⌄                     [☀/🌙] [Share] [Canvas]  │ 48px header
├─────────────────┬────────────────────────────────────────────────────┤
│                 │                                                    │
│ Agent [⏸]       │                                                    │
│  [Thought ▸]    │    ╭───────────────────────────────────────╮      │
│  I'll add a     │    │  ┌──────────────────────────┐        │      │
│  tertiary link  │    │  │  Email                   │        │      │
│  below sign-in… │    │  └──────────────────────────┘        │      │
│                 │    │  ┌──────────────────────────┐        │      │
│ User:           │    │  │  Password                │        │      │
│  Add a forgot   │    │  └──────────────────────────┘        │      │
│  password link  │    │  [Sign In →]                          │      │
│                 │    │                              [Preview]│      │
│                 │    ╰───────────────────────────────────────╯      │
│                 │                                                    │
├─────────────────┤                                                    │
│ [📎 note.png]   │                                                    │
│ [🖥] Ask…       │                                                    │
│            [+][↑]                                                    │
└─────────────────┴────────────────────────────────────────────────────┘
```

**Key changes:**
- **Left (400 px):** Chat column — transcript (arcade `ChatBubble` + `ChatMessages.Agent` with `Thoughts` pills) above, `ChatInput` composite pinned at the bottom.
- **Top:** Single header spanning full width — project name with a chevron (opens project picker), light/dark toggle, Share button (opens Vercel deploy modal), Canvas button (toggles DevModePanel).
- **Right (viewport column):** Iframe with **Option B** differentiation — subtle tint surface + rounded inner frame + "Preview" floating label. No device title bar.
- **Canvas (DevModePanel) when open:** 320 px column sliced off the viewport's right edge; the viewport column shrinks to accommodate — does not overlay.
- **Figma integration:** No explicit "From Figma" button. `ChatInput` detects pasted Figma URLs and triggers the screenshot-export flow inline.

## Visual Differentiation Strategy

The generated UI lives inside the iframe viewport. Studio must provide clear visual boundaries so users never confuse the tool UI with the prototype UI. Both use the same arcade design tokens, so differentiation relies on **structural chrome and subtle surface treatment**.

### Decision: Option B — Subtle Tint + Label Overlay (LOCKED)

Selected for minimal vertical overhead, modern feel, and maximum preview space. Details and implementation styling are under the **"Option B" subsection** below. Options A and C are retained only as alternatives that were considered and rejected.

### Rejected alternatives (kept for historical context)

#### Option A: Device Frame + Title Bar (rejected)

```
┌─ Viewport ─────────────────────────────────────────────────┐
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │
│  ┃ Login Screen               [○][□][X]               ┃  │ ← macOS-style title bar
│  ┃                                                     ┃  │   + traffic lights
│  ┃  [Generated UI content]                            ┃  │
│  ┃                                                     ┃  │
│  ┃                                                     ┃  │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │
└────────────────────────────────────────────────────────────┘
```

**Pros:**
- Strongest visual signal (window-in-window metaphor)
- Familiar to designers (mirrors Figma prototype viewer, Xcode simulator)
- Frame name visible at all times (no need to check sidebar)
- Supports optional device bezels (iPhone, browser, desktop) for responsive testing

**Cons:**
- Adds ~32px vertical overhead (title bar)
- Requires layout adjustment if frame list moves into sidebar
- May feel heavy for desktop-only prototypes

**Styling:**
- Title bar: `background: var(--surface-overlay)`, `border-bottom: 1px solid var(--stroke-neutral-subtle)`, height 32px
- Viewport container: `background: var(--surface-backdrop)` (distinct from `--surface-overlay` used by Studio chrome)
- Optional: `box-shadow: 0 4px 12px rgba(0,0,0,0.08)` on the device frame

---

#### Option B: Subtle Tint + Label Overlay (SELECTED)

```
┌─ Viewport ─────────────────────────────────────────────────┐
│                                                             │
│   ╭────────────────────────────────────────────────╮       │
│   │ [Generated UI content]                         │       │
│   │                                                 │       │
│   │                                                 │       │
│   │                                        [Preview]│       │ ← Floating label
│   ╰────────────────────────────────────────────────╯       │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

**Pros:**
- Minimal overhead (no title bar, just a floating badge)
- Feels lightweight and modern
- Maximizes vertical space for the generated UI

**Cons:**
- Weaker visual signal (just a corner radius + faint outline)
- Label placement competes with generated UI content
- Tint may be too subtle in dark mode

**Styling:**
- Viewport container: `background: linear-gradient(135deg, var(--surface-backdrop) 0%, var(--surface-shallow) 100%)` (very subtle)
- Inner frame: `border: 1px solid var(--stroke-neutral-subtle)`, `border-radius: 12px`
- Label: floating pill in bottom-right corner, `background: var(--surface-overlay)`, `color: var(--fg-neutral-tertiary)`, `font-size: 10px`, `padding: 2px 6px`

---

#### Option C: Colored Border (rejected)

```
┌─ Viewport ─────────────────────────────────────────────────┐
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │
│  ┃ [Generated UI content]                             ┃  │ ← 3px accent border
│  ┃                                                     ┃  │   (blue in light, violet in dark)
│  ┃                                                     ┃  │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │
└────────────────────────────────────────────────────────────┘
```

**Pros:**
- Zero vertical overhead
- High-contrast differentiation

**Cons:**
- Colored border is not part of Computer design language (inconsistent)
- May clash with generated UI color schemes
- Adds visual noise

**Styling:**
- Border: `3px solid var(--stroke-accent-prominent)` (or `var(--stroke-info-prominent)`)

---

### Decision: Option B — locked above.

## Component Migration Map

| Current Component                  | Target Composite/Primitive      | Action        | Notes                                                                 |
|------------------------------------|---------------------------------|---------------|-----------------------------------------------------------------------|
| `App.tsx`                          | (refactor)                      | **MODIFY**    | Already lifted theme state and hash routing. Add Toaster stays as-is. |
| `routes/ProjectList.tsx`           | `StudioHeader` (new)            | **MODIFY**    | Swap custom `<header>` for `StudioHeader`; switch covers to thumbnails |
| `routes/ProjectDetail.tsx`         | `StudioHeader` + chat-left grid | **MODIFY**    | Replace current grid with `header / chat-column viewport-column [canvas]` layout |
| `components/Header.tsx`            | (retire)                        | **RETIRE**    | Replaced by `StudioHeader` (see "New Files" below)                    |
| `components/chat/ChatPane.tsx`     | (refactor)                      | **MODIFY**    | Remove `FigmaUrlModal` trigger; render `ChatMessages`; detect pasted Figma URLs inline |
| `components/chat/PromptInput.tsx`  | `ChatInput` composite           | **REPLACE**   | Full replacement — keep upload/paste/drag logic, switch UI to `ChatInput` |
| `components/chat/MessageBubble.tsx`| `ChatBubble` primitive          | **REPLACE**   | Use arcade `ChatBubble variant="user|assistant"`                      |
| `components/chat/AgentNarration.tsx` | `ChatMessages.Agent` + `Thoughts` | **REPLACE** | Remove italic style; use `Thoughts` pill for tool activity            |
| `components/chat/MessageList.tsx`  | (refactor)                      | **MODIFY**    | Render `ChatBubble` + `ChatMessages.Agent` instead of `MessageBubble` |
| `components/chat/FigmaUrlModal.tsx`| (retire, or keep unused)        | **RETIRE**    | No entry point in the redesigned UI. Paste detection replaces it.      |
| `components/projects/ProjectCard.tsx` | (refactor)                   | **MODIFY**    | Replace `placeholderTint()` gradient with thumbnail image URL         |
| `components/viewport/Viewport.tsx` | (refactor)                      | **MODIFY**    | Add Option B differentiation chrome (tinted surface, rounded inner frame, "Preview" label) |
| `components/devmode/DevModePanel.tsx` | (rebuild as Canvas panel)    | **MODIFY**    | Redesign to mirror Computer's Canvas panel; reduces (not overlays) viewport width when open |
| `prototype-kit/composites/ChatInput.tsx` | (use as-is)               | **USE**       | Already exists; wire up upload/paste/drag + Figma URL detection       |
| `prototype-kit/composites/ChatMessages.tsx` | (use as-is)            | **USE**       | Already exists; map narrations to `Thoughts` items                    |
| `prototype-kit/composites/ComputerSidebar.tsx` | (NOT used in Studio) | **SKIP**      | No sidebar in Studio shell per locked design                          |
| `prototype-kit/composites/ComputerHeader.tsx` | (reference only)     | **SKIP**      | Studio header differs (global actions); build `StudioHeader` instead   |

## Files to Create/Modify

### New Files (to create)

1. **`src/components/shell/StudioHeader.tsx`** — Global top bar used on both ProjectList and ProjectDetail.
   - Props: `title` (string or ReactNode), `right` (actions slot), plus optional `onTitleClick` for a project picker.
   - Height 48 px, border-bottom `1px solid var(--stroke-neutral-subtle)`, background `var(--surface-overlay)`.
   - No traffic lights, no nav arrows.
   - Right-side actions consumed by callers: light/dark toggle, Share, Canvas toggle (on detail), `+ New project` (on list).

2. **`src/components/viewport/ViewportPreview.tsx`** — Option B differentiation wrapper.
   - Wraps the existing `<Viewport />` iframe area.
   - Background gradient (`linear-gradient(135deg, var(--surface-backdrop) 0%, var(--surface-shallow) 100%)`) as the preview "surface".
   - Inner frame with `border: 1px solid var(--stroke-neutral-subtle)` and `border-radius: 12px`.
   - Floating "Preview" pill in bottom-right (`--surface-overlay` bg, `--fg-neutral-tertiary` color, `font-size: 10px`).
   - No title bar, no traffic lights.

3. **`src/components/viewport/CanvasPanel.tsx`** — Redesigned DevModePanel that mirrors the Computer Canvas panel.
   - Reference Figma: compact `167-11216`, expanded `167-11331`.
   - Takes `320 px` (compact) or `480 px` (expanded) of the viewport column's right edge — does not overlay.
   - Retains existing DevModePanel functionality (file tree + file viewer) but with Canvas styling.

4. **`src/components/shell/ShareButton.tsx`** — Header action that opens the Vercel share modal (see `vercel-share.md`).
   - Initial version: disabled with tooltip "Coming soon — see Vercel integration plan" until that plan is executed.

5. **`src/components/shell/ThemeToggle.tsx`** — Header action toggling light/dark.
   - Thin wrapper around arcade `Switch` or a dedicated icon button; calls `onShellModeChange`.

6. **`src/components/shell/CanvasToggle.tsx`** — Header action toggling the CanvasPanel.

7. **`server/thumbnails/capture.ts`** — Thumbnail capture service.
   - `async function captureFrameThumbnail(projectSlug: string, frameSlug: string): Promise<string>`
   - Returns path to saved PNG in `projects/<slug>/thumbnails/<frame-slug>.png`.
   - Called after a successful frame build (hook into Viteʼs `vite:afterUpdate` or a build-success event, or on-demand when Studio first renders a card missing a thumbnail).
   - Implementation choice (Puppeteer vs Playwright) and client-side fallback (html2canvas) covered in Phase 3 — no preference recorded; recommendation stays Puppeteer for server-side fidelity, mock-html2canvas as a v2 if bundle size pressures.

8. **`server/middleware/thumbnails.ts`** — API routes for thumbnail upload/retrieval.
   - `POST /api/projects/:slug/thumbnails/:frame` — receive PNG from client-side capture fallback.
   - `GET /api/projects/:slug/thumbnails/:frame` — serve PNG (or 404 → ProjectCard falls back to `placeholderTint()`).

### Modified Files

1. **`src/App.tsx`** — already landed: hash routing, lifted theme state, `<Toaster />`. No further changes required for this phase.

2. **`src/routes/ProjectList.tsx`**
   - Swap the inline `<header>` for `<StudioHeader right={<ThemeToggle/><NewProjectButton/>} />`.
   - Pass the `thumbnail` field to `<ProjectCard>` (see below).

3. **`src/routes/ProjectDetail.tsx`**
   - Remove inline `<Header />` usage; replace with `<StudioHeader right={<ThemeToggle/><ShareButton/><CanvasToggle/>} title={<ProjectPicker project={project} />} />`.
   - Adjust grid:
     - Without Canvas: `grid-template-columns: 400px 1fr` (chat · viewport).
     - With Canvas: `grid-template-columns: 400px 1fr 320px` (chat · viewport · canvas).
   - Wrap the main column content in `<ViewportPreview><Viewport /></ViewportPreview>`.
   - Drop `reloadKey`/`key={reloadKey}` hack if theme propagation now handles it cleanly (verify during phase 5).

4. **`src/components/chat/ChatPane.tsx`**
   - Remove `<FigmaUrlModal />` trigger and `onPickFigma` prop.
   - Detect Figma URLs inside submitted prompts (already partially wired via `extractFigmaUrl` / `decoratePromptWithFigma`); keep this inline detection.
   - Replace `<MessageList />` wrapper with `<ChatMessages>` composite.
   - Retain error banner and retry logic.

5. **`src/components/chat/MessageList.tsx`** — already partially updated (items-aware). Replace raw `<MessageBubble>` + `<AgentActivityItem>` output with arcade `<ChatBubble>` + `<ChatMessages.Agent>` + `<Thoughts>` pills.

6. **`src/components/chat/PromptInput.tsx`**
   - Full replacement with `ChatInput` composite from `prototype-kit`.
   - Keep existing upload/paste/drag handlers.
   - Map attachments to `<ChatInput.FileAttachment>`.
   - Use `<ChatInput.AddAttachmentButton>` (the "+" button) and `<ChatInput.SendButton>`.
   - Remove the "From Figma" chip entirely; add onPaste handler that spots a Figma URL and triggers the export flow silently.

7. **`src/components/projects/ProjectCard.tsx`**
   - If `project.thumbnail` (or frame thumbnail) is present, render `<img>`; otherwise fall back to `placeholderTint(project.theme)` gradient.

8. **`src/components/devmode/DevModePanel.tsx`**
   - Rebuild to mirror Computer Canvas panel (Figma nodes `167-11216` compact, `167-11331` expanded).
   - Add compact/expanded state toggle internally.
   - Keep existing tree + file-viewer data wiring intact.

9. **`server/types.ts`**
   - Add `thumbnail?: string` to `Project` (path relative to projectDir, e.g. `thumbnails/login.png`).
   - Optionally add per-frame `thumbnail?: string` on `Frame` for finer-grained snapshots.

10. **`server/projects.ts` + a new frame-build hook**
    - After a successful frame write, enqueue `captureFrameThumbnail(slug, frameSlug)`.
    - Persist the result path into the project JSON.
    - First-frame's thumbnail becomes the project card cover.

11. **`src/components/Header.tsx`** — delete after `StudioHeader` lands and both routes are migrated.

12. **`package.json`** — add `puppeteer` (or `playwright` headless) for server-side capture. Decision deferred to Phase 3 — default to Puppeteer unless bundle-size or Linux compat is a concern.

## Implementation Phases

### Phase 1: Shell Layout Refactor (StudioHeader, Chat-Left Grid, Theme Wiring)

**Goal:** Replace the old `Header + aside` layout with a single `StudioHeader` up top and a chat-on-left grid. Theme state is already lifted (landed this session) — Phase 1 only needs to finish wiring it to the new shell.

**Tasks:**

1. **Create `src/components/shell/StudioHeader.tsx`**
   - Height 48 px, full-width, border-bottom, no traffic lights, no nav arrows.
   - Props: `{ title, right?: ReactNode, onTitleClick?: () => void }`.
   - `title` accepts either a string (plain) or a node (project picker chevron + project name).

2. **Create header action sub-components**
   - `ThemeToggle.tsx` — reads `shellMode` from props or context, calls `onShellModeChange`.
   - `ShareButton.tsx` — disabled with tooltip "Coming soon" until the Vercel plan lands.
   - `CanvasToggle.tsx` — opens/closes `DevModePanel` (state lives in `ProjectDetail`).

3. **Modify `src/routes/ProjectList.tsx`**
   - Replace the inline `<header>` with `<StudioHeader title="Studio" right={<><ThemeToggle /><NewProjectButton /></>} />`.
   - Keep the grid + cards + search logic; only the header changes visually.

4. **Modify `src/routes/ProjectDetail.tsx`**
   - Remove `<Header />` usage; render `<StudioHeader title={<ProjectPicker project={project} />} right={<><ThemeToggle /><ShareButton /><CanvasToggle active={canvasOpen} onToggle={...} /></>} />`.
   - Grid rules:
     - Rows: `48px 1fr`.
     - Columns (no canvas): `400px 1fr` — chat · viewport.
     - Columns (canvas open): `400px 1fr 320px` — chat · viewport · canvas.
   - Chat column is `<aside>` with the existing `<ChatPane />` inside.
   - Viewport column wraps `<Viewport />` in `<ViewportPreview />` (created in Phase 4).

5. **Retire `src/components/Header.tsx`** once both routes are migrated.

6. **Theme persistence (small follow-up)**
   - Already: `shellMode` lives in `App.tsx` and flows into `DevRevThemeProvider`.
   - Add: persist `shellMode` to `localStorage` key `arcade-studio:theme` so the user-level default survives reload. Per-project `project.mode` continues to take precedence inside `ProjectDetail`.

**Exit Criteria:**
- Both routes render via `<StudioHeader />`.
- Chat pane is the left column on `ProjectDetail`.
- Theme toggle in the header flips the whole shell (not just the iframe).
- `<CanvasToggle>` shows/hides a placeholder panel on the right edge (functional rebuild in Phase 5).
- No layout regressions in chat, viewport, or project list.

---

### Phase 2: Chat Pane Refactor (ChatInput + ChatMessages Composites, Figma Paste Detection)

**Goal:** Replace custom chat UI components with the Computer chat composites, drop the "From Figma" button, and wire paste-based Figma URL detection into the input.

**Tasks:**

1. **Modify `src/components/chat/MessageList.tsx`**
   - Replace `<MessageBubble role="user">` with `<ChatBubble variant="user">`.
   - Replace `<MessageBubble role="assistant">` with `<ChatBubble variant="assistant">`.
   - Replace `<AgentActivityItem>` / `<AgentNarration>` calls with:
     ```tsx
     <ChatMessages.Agent
       thoughts={
         <ChatMessages.Thoughts label="Working">
           {items.map((item, i) => (
             <ChatMessages.ThoughtItem key={i}>
               {item.kind === "narration" ? item.text : item.pretty}
             </ChatMessages.ThoughtItem>
           ))}
         </ChatMessages.Thoughts>
       }
     />
     ```
   - Collapse consecutive duplicates (logic already in `collapseNarrations` — reuse).

2. **Replace `src/components/chat/PromptInput.tsx`** (full rewrite)
   - Copy existing upload handlers (`addFiles`, `onPaste`, `onDrop`, `onFilePicked`).
   - Replace UI with `<ChatInput>` composite:
     ```tsx
     <ChatInput
       value={text}
       onChange={(e) => setText(e.target.value)}
       onSubmit={handleSubmit}
       attachments={
         <>
           {images.map((url, i) => (
             <ChatInput.FileAttachment key={i} kind="IMG" name={`attachment-${i}`} />
           ))}
           {detectedFigmaUrl && (
             <ChatInput.ContextAttachment label="Figma frame" hint={detectedFigmaUrl} />
           )}
         </>
       }
       trailing={
         <>
           <ChatInput.AddAttachmentButton onClick={handlePickImage} />
           <ChatInput.SendButton onClick={handleSubmit} disabled={!text.trim() || busy} />
         </>
       }
     />
     ```
   - Remove the "From Figma" chip entirely. Remove `onPickFigma` prop.

3. **Wire Figma paste detection in `PromptInput`**
   - In the textarea `onPaste` handler, call `extractFigmaUrl(pastedText)` (already exists in `src/lib/figmaUrl.ts`).
   - If a Figma URL is detected, stash it in a local `detectedFigmaUrl` state and render it as `<ChatInput.ContextAttachment>`. Strip the URL from the inserted text (or keep it — product decision; default: keep, visible as a chip below input).
   - On submit, `enhancedSend()` already decorates via `decoratePromptWithFigma`; keep that call path.

4. **Modify `src/components/chat/ChatPane.tsx`**
   - Remove `<FigmaUrlModal />` import + JSX and the `setShowFigma`/`showFigma` state.
   - Remove `onPickFigma` prop from `<PromptInput />`.
   - Keep `extractFigmaUrl()` / `decoratePromptWithFigma()` inside `enhancedSend()`.
   - Wrap `<MessageList />` in `<ChatMessages>` composite.

5. **Retire `src/components/chat/FigmaUrlModal.tsx`** — delete file (no callers left).

6. **Retire `src/components/chat/MessageBubble.tsx`** — delete after Phase 2 migration. `ChatBubble` replaces it.

7. **Retire `src/components/chat/AgentNarration.tsx`** — delete after Phase 2 migration. `ChatMessages.Agent` + `Thoughts` replace it.

**Exit Criteria:**
- Chat input uses `ChatInput` composite with "+" attachment button and arrow `SendButton`. No "Attach image" chip, no "From Figma" chip.
- Chat transcript uses arcade `ChatBubble` + `ChatMessages.Agent` + `Thoughts` pills.
- Pasting a Figma URL into the input surfaces a `ContextAttachment` chip and still triggers the export flow on submit.
- Image upload, paste, drag-drop still work.

---

### Phase 3: Project Covers / Thumbnail Capture System

**Goal:** Replace gradient placeholder covers with auto-captured snapshots of generated frames.

**Decision Point:** Choose thumbnail capture method.

**Option 3A: Server-side Puppeteer/Playwright (RECOMMENDED)**

**Pros:**
- High fidelity (real browser rendering, fonts, CSS)
- Works for SSR/headless builds
- No CORS issues

**Cons:**
- Adds ~200MB dependency (Chromium binary)
- Requires server-side Node environment (not compatible with edge/serverless without extra config)

**Tasks (Option 3A):**

1. **Add dependency**
   - Run `npm install puppeteer` (or `@playwright/test`) in server-side package
   - Verify Chromium binary downloads successfully

2. **Create `server/thumbnails/capture.ts`**
   ```typescript
   import puppeteer from 'puppeteer';

   export async function captureFrameThumbnail(
     projectSlug: string,
     frameSlug: string
   ): Promise<string> {
     const browser = await puppeteer.launch({ headless: true });
     const page = await browser.newPage();
     await page.setViewport({ width: 1280, height: 720 });
     await page.goto(`http://localhost:3000/api/frames/${projectSlug}/${frameSlug}`, {
       waitUntil: 'networkidle2'
     });
     const screenshotPath = `projects/${projectSlug}/thumbnails/${frameSlug}.png`;
     await page.screenshot({ path: screenshotPath, type: 'png' });
     await browser.close();
     return screenshotPath;
   }
   ```

3. **Create `server/routes/thumbnails.ts`**
   - `GET /api/projects/:slug/thumbnails/:frame` — serve PNG or 404
   - Add route to server (Express/Fastify/etc.)

4. **Modify build/frame creation hook** (e.g., `server/build.ts` or wherever frames are written)
   - After successful frame build, call `captureFrameThumbnail(projectSlug, frameSlug)`
   - Update project JSON: `project.thumbnail = screenshotPath`
   - Fallback: if capture fails, log warning and continue (graceful degradation to gradient)

5. **Modify `server/types.ts`**
   - Add `thumbnail?: string` field to `Project` type

6. **Modify `components/projects/ProjectCard.tsx`**
   - Replace `background: placeholderTint(project.theme)` with:
     ```tsx
     {project.thumbnail ? (
       <img src={`/api/${project.thumbnail}`} alt={project.name} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8 }} />
     ) : (
       <div style={{ height: 120, borderRadius: 8, background: placeholderTint(project.theme) }} />
     )}
     ```

**Option 3B: Client-side html2canvas**

**Pros:**
- No server dependency
- Lightweight (~50KB)

**Cons:**
- Lower fidelity (fonts may not render, CSS edge cases)
- Requires iframe access (CORS constraints)
- Only works for user-triggered captures (not automated on build)

**Tasks (Option 3B):**

1. **Add dependency**
   - Run `npm install html2canvas` in client-side package

2. **Create `src/lib/captureClient.ts`**
   ```typescript
   import html2canvas from 'html2canvas';

   export async function captureFromIframe(iframeEl: HTMLIFrameElement): Promise<Blob> {
     const doc = iframeEl.contentDocument;
     if (!doc) throw new Error('Cannot access iframe document');
     const canvas = await html2canvas(doc.body);
     return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!)));
   }
   ```

3. **Create `server/routes/thumbnails.ts`**
   - `POST /api/projects/:slug/thumbnails/:frame` — receive PNG blob, write to disk, return path
   - `GET /api/projects/:slug/thumbnails/:frame` — serve PNG or 404

4. **Modify `components/viewport/Viewport.tsx`**
   - After successful frame load, call `captureFromIframe(iframeRef.current)`
   - POST blob to `/api/projects/${slug}/thumbnails/${frame}`
   - Update local project state: `setProject({ ...project, thumbnail: response.path })`

5. **Modify remaining files** (same as Option 3A steps 5-6)

**Decision Needed:** Choose Option 3A (Puppeteer/Playwright) or Option 3B (html2canvas).

**Recommendation:** **Option 3A** for V1. Higher fidelity and automated capture on build. Accept the dependency cost (200MB is acceptable for a dev tool).

**Exit Criteria:**
- Project cards display generated UI snapshots instead of gradient placeholders
- Thumbnails auto-update after successful frame builds
- Fallback to gradient if thumbnail not yet generated or capture fails
- No performance regressions on build (capture runs async, doesn't block)

---

### Phase 4: Visual Differentiation Pass (Option B — Subtle Tint + Preview Label)

**Goal:** Implement the locked Option B treatment so the generated UI is clearly separated from Studio chrome without adding vertical device-frame overhead.

**Tasks:**

1. **Create `src/components/viewport/ViewportPreview.tsx`**
   ```tsx
   export function ViewportPreview({ children }: { children: ReactNode }) {
     return (
       <div
         style={{
           display: "flex",
           alignItems: "stretch",
           justifyContent: "stretch",
           height: "100%",
           padding: 24,
           position: "relative",
           background:
             "linear-gradient(135deg, var(--surface-backdrop) 0%, var(--surface-shallow) 100%)",
         }}
       >
         <div
           style={{
             flex: 1,
             border: "1px solid var(--stroke-neutral-subtle)",
             borderRadius: 12,
             overflow: "hidden",
             background: "var(--surface-overlay)",
           }}
         >
           {children}
         </div>
         <span
           style={{
             position: "absolute",
             bottom: 12,
             right: 12,
             padding: "2px 6px",
             fontSize: 10,
             color: "var(--fg-neutral-tertiary)",
             background: "var(--surface-overlay)",
             border: "1px solid var(--stroke-neutral-subtle)",
             borderRadius: 6,
             letterSpacing: 0.4,
             textTransform: "uppercase",
           }}
         >
           Preview
         </span>
       </div>
     );
   }
   ```

2. **Modify `src/components/viewport/Viewport.tsx`**
   - Wrap the outermost `<iframe />` (or frame grid) in `<ViewportPreview>`.
   - No frame name / no title bar / no traffic lights.

3. **Modify `src/routes/ProjectDetail.tsx`** — wire the new wrapper in the viewport column (see Phase 1 grid tasks).

4. **Visual QA pass**
   - Light mode: verify gradient is visible but subtle; border + preview pill are legible.
   - Dark mode: verify tokens resolve correctly (gradient darker, pill visible).
   - Resize viewport: verify pill stays in corner and inner frame scales cleanly.
   - Compare side-by-side against Computer app: Studio UI feels "host", generated UI feels "contained".

**Exit Criteria:**
- Generated UI renders inside a tinted container with a rounded inner frame and a floating "Preview" label.
- No device title bar, no traffic lights.
- Token switches (light/dark) cascade correctly through the preview surface.

---

### Phase 5: Theme Propagation + DevModePanel Canvas Rebuild

**Goal:** Finish theme propagation to the whole shell (including the new `CanvasPanel`) and redesign `DevModePanel` to mirror the Computer Canvas panel.

**Theme tasks:**

1. Lifted theme state already lives in `App.tsx` (completed this session). Verify everything downstream still honors it.
2. Add global persistence: `localStorage['arcade-studio:theme']` — hydrated on mount, updated whenever the header toggle fires while no project is open.
3. On `ProjectDetail` open, `project.mode` takes precedence (already wired).
4. Confirm `<StudioHeader>`, chat column, viewport preview surface, and CanvasPanel all respond to `[data-theme]` cascade. No per-component theme props.

**DevModePanel (CanvasPanel) rebuild:**

5. Study the Figma reference nodes: compact `167-11216`, expanded `167-11331` (linked in Non-goals).
6. Rebuild `src/components/devmode/DevModePanel.tsx` (or introduce a sibling `CanvasPanel.tsx` if the diff gets too large) with:
   - Header bar matching Computer Canvas (icon, title, expand/collapse toggle).
   - Two widths: compact (`320 px`) and expanded (`480 px`), controlled internally.
   - Existing file tree + file viewer content, restyled to Canvas tokens.
7. Wire `<CanvasToggle />` in the header to toggle visibility, and add an internal expand/collapse button within the panel.
8. When the panel opens, `ProjectDetail`'s grid becomes `400px 1fr 320px` (or `480px` if expanded). Grid transitions `0.2s ease`.

**Theme verification script:**

- Light shell + open project with `mode: "light"` → all shell + iframe + canvas light.
- Toggle shell to dark → shell + canvas go dark, iframe follows (already wired).
- Close project → shell respects `arcade-studio:theme` global.

**Exit Criteria:**
- Theme toggle flips shell + canvas + viewport wrapper + iframe in one click, no flicker.
- Global theme persists across reloads when no project is open.
- DevModePanel looks like Computer's Canvas panel in both compact and expanded states.
- Opening / closing the Canvas panel animates smoothly and never overlays the viewport.

---

### Phase 6: Polish (Loading States, Empty States, Transitions)

**Goal:** Add finishing touches—loading skeletons, empty states, smooth transitions—to match Computer app polish level.

**Tasks:**

1. **Add loading skeleton to ProjectList**
   - While projects load, show 3 skeleton cards (gray animated pulse)
   - Use arcade `<Skeleton />` component (if available) or custom CSS animation

2. **Add empty state to ProjectList**
   - When `projects.length === 0`, show centered empty state:
     - Faded Computer wordmark
     - Heading: "No projects yet"
     - Subheading: "Create your first prototype to get started"
     - `<Button variant="primary">+ New project</Button>`

3. **Add empty state to chat transcript** (already exists via `ChatPane` logic)
   - Verify `EmptyStatePrompts` component still renders when `history.length === 0`
   - Optionally replace with `ChatEmptyState` composite from prototype-kit (faded Computer wordmark)

4. **Add loading state to chat input**
   - While `busy === true`, replace `SendButton` with `StopButton` (or disable `SendButton`)
   - Add pulsing animation to `ChatMessages.Agent` pause glyph (indicates streaming)

5. **Add transitions to the Canvas panel open/close**
   - Animate viewport column width: `transition: width 0.2s ease`.
   - Animate CanvasPanel width between compact/expanded states.
   - Verify no layout shift when toggling or resizing.

6. **Add keyboard shortcuts** (optional)
   - `Cmd+K` — focus chat input.
   - `Cmd+Shift+D` — toggle Canvas (DevModePanel).
   - `Cmd+Shift+L` — toggle theme.

**Exit Criteria:**
- Loading skeletons display while data fetches.
- Empty states render when lists are empty.
- Smooth transitions on Canvas open/close and theme toggle.
- No jank or layout shift during transitions.

---

## Resolved Decisions

All six design questions previously flagged have been answered:

| # | Question                          | Decision                                                                                       |
|---|-----------------------------------|------------------------------------------------------------------------------------------------|
| 1 | Sidebar layout                    | **No sidebar.** Single top `StudioHeader` on both routes.                                      |
| 2 | Chat pane placement               | **Left column, full-height** (`400 px`), next to the viewport.                                 |
| 3 | Visual differentiation treatment  | **Option B** — subtle tint + "Preview" floating label. No device frame, no title bar.          |
| 4 | Thumbnail capture method          | No preference recorded; plan defaults to **server-side Puppeteer**. Revisit if deploy pressure. |
| 5 | Figma button placement            | **Drop from chat UI**; detect pasted Figma URLs in `ChatInput` and trigger export inline.      |
| 6 | Theme persistence scope           | **Per-project with global fallback** (project `mode` overrides, global `localStorage` otherwise). |

Additional clarifications captured during review:

- **No traffic lights, no nav arrows** anywhere in Studio.
- **Header actions** (top-right, in order): Light/dark toggle · Share (Vercel) · Canvas (DevModePanel) toggle.
- **DevModePanel reduces the viewport column** when open (never overlays). Styled to mirror Computer Canvas (Figma nodes `167-11216` compact, `167-11331` expanded).
- **Model selector** — not in scope. No control for it in the redesign.

---

## Risks

### Visual Regressions

**Risk:** Swapping composites may introduce layout shifts, broken padding, or misaligned elements.

**Mitigation:**
- Phase-by-phase rollout (test each phase in isolation)
- Visual regression testing via Playwright (screenshot comparison before/after)
- QA checklist per phase (see Exit Criteria above)

### Token Gaps

**Risk:** Arcade tokens may not cover all Computer app styles (e.g., specific border colors, shadow depths, corner radii).

**Mitigation:**
- Audit Computer composites for any hardcoded styles (e.g., `#FF5F57` traffic light red)
- Document gaps in open questions file
- Fallback to closest available token if exact match unavailable

### Theme Propagation Bugs

**Risk:** Theme toggle may not propagate to all Studio shell areas (sidebar, header, chat, viewport frame).

**Mitigation:**
- Centralize theme state in `App.tsx` via `useTheme()` hook
- Use CSS cascading (`data-theme` attribute on `<html>`) instead of per-component theme props
- Test theme toggle in light mode, dark mode, and during iframe load

### Thumbnail Performance

**Risk:** Puppeteer/Playwright capture may be slow (2-5s per screenshot) or fail intermittently.

**Mitigation:**
- Run capture async (don't block build completion)
- Add timeout (5s max) with graceful fallback to gradient
- Retry once on failure before giving up
- Consider caching thumbnails (skip re-capture if frame hasn't changed)

### Layout Shift on Sidebar Collapse

**Risk:** Toggling sidebar visibility may cause viewport to jump or flicker.

**Mitigation:**
- Use CSS Grid with explicit column widths (not `auto`)
- Animate width via `transition: width 0.2s ease`
- Test with DevModePanel open (3-column layout) to ensure no jank

### Figma Middleware Breakage

**Risk:** Removing "From Figma" button may orphan the Figma URL middleware/CLI tooling.

**Mitigation:**
- Keep middleware intact (only remove UI entry point)
- Document in code comments: "Figma URL paste detection still works; users paste URLs directly into chat input"
- Add integration test: paste Figma URL into chat input → verify screenshot export triggers

### Project Picker Behaviour

**Risk:** The new header's project-name chevron (`<ProjectPicker>`) needs to work without the familiar sidebar list.

**Mitigation:**
- Start with a simple dropdown of the user's most recent 10 projects + a "View all…" link that navigates to `ProjectList`.
- Keep Studio's current ephemeral `openSlug` flow; picker calls the same `openProject(slug)` handler.

### Canvas ↔ Viewport Width Rebalancing

**Risk:** Opening the Canvas panel shrinks the viewport column. For small frame sizes (375 px) the margin can feel cramped.

**Mitigation:**
- Default Canvas to compact (320 px).
- Expanded (480 px) is opt-in via the panel's own header button.
- If the viewport column would fall below a safe minimum (say 480 px), auto-close Canvas or show a "Viewport too narrow" hint.

---

## Remaining Open Questions

Decisions above resolve the blocking questions. The remaining items are lower-priority and not on the critical path:

- [ ] **Project picker UX** — dropdown vs full modal search? Default: dropdown of recent projects with "View all".
- [ ] **Keyboard shortcuts** — `Cmd+K` focus input, `Cmd+Shift+D` Canvas, `Cmd+Shift+L` theme. Confirm before Phase 6.
- [ ] **User footer source** — No auth system today. Hardcode `"User"` + neutral avatar for v1; revisit when login lands.
- [ ] **Mobile/tablet responsive** — desktop-only for v1.
- [ ] **Viewport zoom slider** — out of scope for v1; belongs to `device-viewport-switch.md`.
- [ ] **Frame history / version snapshots** — out of scope for v1.

---

## Success Metrics

- **Visual consistency:** Studio shell matches Computer app aesthetic (confirmed via side-by-side screenshot comparison).
- **Theme propagation:** Light/dark toggle updates 100% of Studio chrome — header, chat column, viewport preview surface, Canvas panel — in one click.
- **Thumbnail coverage:** ≥80% of projects display generated UI snapshots instead of gradient placeholders within 1 week of v1 launch.
- **Visual differentiation:** Usability testing confirms users can distinguish Studio UI from generated UI without prompting (Option B tint + "Preview" pill).
- **No regressions:** Zero critical bugs in chat input, image upload, theme toggle, or viewport rendering post-launch.
- **Performance:** Thumbnail capture runs async and never blocks the UI; p95 capture-to-card-visible ≤ 3 s.

---

## Dependencies

- **arcade-gen tokens** (`arcade-gen/src/tokens/generated/`) — already available; no changes.
- **prototype-kit composites** (`studio/prototype-kit/composites/`) — uses `ChatInput` and `ChatMessages`; skips `ComputerSidebar` and `ComputerHeader`.
- **Puppeteer (or Playwright headless)** — new server-side dependency introduced in Phase 3.
- **Auth context** — not required for v1 (placeholder user). Future phase.

---

## Appendix: Code Snippets

### Example: StudioHeader

```tsx
import type { ReactNode } from "react";

export function StudioHeader({
  title,
  right,
}: {
  title: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 48,
        padding: "0 16px",
        background: "var(--surface-overlay)",
        borderBottom: "1px solid var(--stroke-neutral-subtle)",
      }}
    >
      <div style={{ fontWeight: 540, color: "var(--fg-neutral-prominent)" }}>
        {title}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{right}</div>
    </header>
  );
}
```

### Example: ChatInput with Upload Handlers

```tsx
import { ChatInput } from '../../prototype-kit/composites/ChatInput';
import { useState, useRef } from 'react';

export function PromptInputReplacement({ onSend, busy, projectSlug }: { onSend: (text: string, images: string[]) => void; busy: boolean; projectSlug: string }) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadImage(blob: Blob): Promise<{ path: string; url: string }> {
    const res = await fetch(`/api/uploads/${projectSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type },
      body: blob,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  }

  async function addFiles(files: File[] | FileList) {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    for (const f of arr) {
      const { path, url } = await uploadImage(f);
      setImages((xs) => [...xs, url]);
      setImagePaths((xs) => [...xs, path]);
    }
  }

  const handlePickImage = () => fileInputRef.current?.click();

  const handleSubmit = () => {
    if (!text.trim() || busy) return;
    onSend(text, imagePaths);
    setText('');
    setImages([]);
    setImagePaths([]);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => e.target.files && addFiles(e.target.files)}
      />
      <ChatInput
        value={text}
        onChange={(e) => setText(e.target.value)}
        onSubmit={handleSubmit}
        attachments={
          images.length > 0 ? (
            <>
              {images.map((url, i) => (
                <ChatInput.FileAttachment key={i} kind="IMG" name={`image-${i}`} />
              ))}
            </>
          ) : undefined
        }
        trailing={
          <>
            <ChatInput.AddAttachmentButton onClick={handlePickImage} />
            <ChatInput.SendButton onClick={handleSubmit} disabled={!text.trim() || busy} />
          </>
        }
      />
    </>
  );
}
```

---

## Estimated Effort

| Phase | Effort (days) | Risk | Notes |
|-------|---------------|------|-------|
| Phase 1: StudioHeader + chat-left grid | 2-3 | Medium | Header + grid rewrite; some theme-lift work already landed |
| Phase 2: Chat composites + Figma paste | 2-3 | Low | Swap to `ChatInput` + `ChatMessages`; paste-url detection |
| Phase 3: Thumbnails | 3-5 | High | Puppeteer + async capture; perf/QA needed |
| Phase 4: Option B differentiation | 1 | Low | Single wrapper component |
| Phase 5: Theme global + CanvasPanel rebuild | 2-3 | Medium | CanvasPanel Figma spec-matching is the variable |
| Phase 6: Polish | 1-2 | Low | Loading states, transitions, shortcuts |
| **Total** | **11-17 days** | | Assumes 1 engineer, includes per-phase QA. Some Phase-1 groundwork already merged |

---

## Revision History

- **2026-04-23** — Initial draft (Planner agent).
- **2026-04-24** — Revised per user feedback. Removed Computer sidebar in favor of a header-only shell. Chat moved to the left column. Locked Option B for viewport differentiation. Added CanvasPanel (DevModePanel) redesign referencing Computer Canvas. Dropped the "From Figma" button in favor of paste-url detection. Resolved all six design decisions.
