# Branded homepage — design

Status: draft
Date: 2026-05-04
Figma reference: <https://www.figma.com/design/7XMoVTP12VjLUF8SDUef3W/Untitled?node-id=1-689>

## Goal

Turn Studio's homepage from a utilitarian project list into a branded landing
surface whose primary affordance is a large, borderless prompt input that
creates a new project on submit. The existing project gallery stays, but
becomes secondary.

## Non-goals

- No changes to the per-project chat pane, viewport, or generator pipeline.
  The hero input creates a project and then hands the first prompt off to
  the existing `/api/chat` flow unchanged.
- No new integrations. Model selector reads and writes the `studio.model`
  setting that `AppSettingsModal` already owns.
- Not touching search behavior anywhere else in the app — search is removed
  only from the homepage.

## User-facing behavior

1. Opening the app lands the user on the homepage.
2. The hero input is front and centre with placeholder
   `What we're building today?` at 50px, 48% opacity.
3. As the user types, typed text is opacity 1. When the content would exceed
   the hero's max height, font size shrinks smoothly to keep everything
   visible, down to a floor where the textarea starts scrolling instead.
4. The user can paste/drop images, paste a Figma URL, or type `@Computer` —
   the same attachment chips that appear in the chat input show up above the
   trailing controls row.
5. Model selector ("Auto / Sonnet / Opus / Haiku") sits to the left of the
   `+` and send buttons.
6. Hitting send:
   - Derives a project name from the first ~40 chars of the prompt.
   - Creates the project.
   - Adopts any staged image uploads into the new project's uploads folder.
   - Navigates to the project view.
   - Fires the prompt as the first chat turn, with image paths, Figma URL
     decoration, and any `@Computer` mention intact.
7. Below the hero, a compact 3-column grid of `ProjectCard`s shows existing
   projects. Zero projects → the whole section is omitted.

## Architecture

### File layout

```
studio/src/
├── routes/
│   └── HomePage.tsx                 NEW — replaces the body of ProjectList.tsx
└── components/
    ├── home/                        NEW
    │   ├── HeroPromptInput.tsx
    │   └── ProjectsSection.tsx
    └── projects/
        └── ProjectCard.tsx          unchanged, re-used
```

`ProjectList.tsx` is renamed to `HomePage.tsx`; `App.tsx`'s import is updated.
The old `ProjectList` name and file go away (one file per route).

### Shared composition logic

Prompt-input state is shared between the existing `PromptInput` (in-project
chat) and the new `HeroPromptInput` via a hook:

```ts
// studio/src/hooks/usePromptComposer.ts
export function usePromptComposer(opts: {
  projectSlug?: string; // undefined on the homepage
}): {
  text: string;
  setText: (s: string) => void;
  images: string[];          // preview URLs
  imagePaths: string[];      // server paths (staging when no slug, project-scoped otherwise)
  addFiles: (fs: File[] | FileList) => Promise<void>;
  detectedFigmaUrl: string | null;
  setDetectedFigmaUrl: (u: string | null) => void;
  onPaste: (e: ClipboardEvent) => void;
  onDrop: (e: DragEvent) => void;
  uploadError: string | null;
  clear: () => void;
};
```

`PromptInput` is refactored to source `text / images / imagePaths /
detectedFigmaUrl / addFiles / onPaste / onDrop / uploadError` from this hook
but keeps its target-chip and mention-popover logic locally (those need
project-scoped wiring).

`HeroPromptInput` uses the same hook with `projectSlug: undefined` so uploads
go to the staging endpoint (see below).

### Staging uploads

The existing upload endpoint is `POST /api/uploads/:projectSlug`. The hero
has no slug yet. To avoid eagerly creating orphan projects, add:

- `POST /api/uploads/_staging` — writes to
  `<studioRoot>/uploads-staging/<sessionId>/<filename>` and returns
  `{ path, url }` shaped the same as the existing endpoint. `sessionId` is
  created per-browser-session and persisted in `sessionStorage`.
- `POST /api/projects/:slug/adopt-uploads` — body
  `{ paths: string[] }`. Moves each file from staging into the project's
  uploads folder and returns a map of `oldPath → newPath`. Missing files
  (e.g. file already moved, session expired) are skipped and surfaced in
  the response so the client can toast.

Staging folder is cleaned at Studio launch for sessions older than 24h.

### Pending-prompt handoff (home → project)

A `PendingPromptContext` at the App root:

```ts
interface PendingPrompt {
  prompt: string;
  imagePaths: string[];
  figmaUrl: string | null;
}
interface PendingPromptContextValue {
  pending: PendingPrompt | null;
  set: (p: PendingPrompt) => void;
  consume: () => PendingPrompt | null; // returns + clears in one call
}
```

`HeroPromptInput.onSubmit` calls `set(...)` before `onOpen(slug)` navigates.
`ChatPane` on mount calls `consume()`. If a pending prompt is returned, it
fires `enhancedSend(prompt, imagePaths)` exactly once. Context is purely
in-memory — a refresh between submit and chat-mount is vanishingly rare
(both are programmatic within the same render cycle), and losing a prompt
in that edge case is preferable to leaking pending prompts into later
sessions.

## Component specs

### `HeroPromptInput`

Props:

```ts
interface HeroPromptInputProps {
  onSubmit: (args: {
    prompt: string;
    imagePaths: string[];
    figmaUrl: string | null;
  }) => Promise<void>;
  disabled?: boolean; // while create-project is in flight
}
```

Layout (rendered):

```
┌─ (no border, no bg, no shadow) ────────────────────────────┐
│ ▍                                                          │  ← 4×60 accent bar
│  What we're building today?                                │  ← placeholder / typed
│                                                            │     text, font-scales
│  [chip] [chip] [chip]                                      │  ← attachments, if any
│                                [Auto ▾]  [＋]  [↑]          │  ← trailing controls
└────────────────────────────────────────────────────────────┘
```

Typography:
- Text/placeholder: `Chip_Display_Variable Semibold`.
- Starting font-size: 50px. Line-height: `normal`.
- Placeholder: opacity 0.48. Typed text: opacity 1.
- Color: `var(--fg-neutral-prominent)`.
- Textarea: `resize: none`, `border: 0`, `outline: 0`, `bg: transparent`,
  `width: 100%`.

Accent bar:
- 4px × 60px, `var(--fg-neutral-black)`, 8px radius.
- Positioned at the top-left of the hero block, aligned with the first line
  of the typed text (Figma node `1:692`).

Attachments row:
- Reuses `ChatInput.ContextAttachment` and `ChatInput.FileAttachment` chips.
- Supported chips (in this order): target stays off for the hero (no frame
  context yet); `@Computer` chip when text matches `/@Computer\b/i`; image
  chips for each upload; Figma frame chip when a Figma URL is detected.
- Horizontal scroll if it overflows, scrollbar hidden (matches `ChatInput`).

Trailing controls row (bottom-right of the hero block):
- **Model selector** — a pill-shaped button that opens a menu. Label shows
  the human-readable model alias (`Auto`, `Sonnet`, `Opus`, `Haiku`), same
  mapping as `MODEL_OPTIONS` in `AppSettingsModal.tsx`. Persists to
  `/api/settings` `studio.model` on change. Uses the existing `Select` from
  `@xorkavi/arcade-gen` (keyed on `MODEL_DEFAULT_SENTINEL` for the "Auto"
  case to avoid Radix's empty-string restriction).
- **`+` button** — `ChatInput.AddAttachmentButton`, opens the file picker.
- **Send button** — `ChatInput.SendButton` (yellow expressive variant).
  Disabled iff `text.trim().length === 0 || disabled`.

Font-shrink behavior:
- After every `onChange`:
  - Set textarea height to `auto` to get a clean `scrollHeight`.
  - Compute `maxHeight = 3 × startingLineHeight(50px)`.
  - While `scrollHeight > maxHeight && currentFontSize > 20px`: subtract 2px
    from `font-size`, re-measure.
  - While growing: if `currentFontSize < 50px`, try `+2px` and re-measure;
    keep only if it still fits under `maxHeight`.
  - Set `textarea.style.height` to `min(scrollHeight, maxHeight)`; set
    `overflow-y: auto` if clipped.
- Transition: `font-size 120ms ease-out` on the textarea.
- Resizing runs inside `useLayoutEffect` keyed on `text` so the user never
  sees a flash of mis-sized text.

Interactions:
- Enter (no shift) → `submit()`. Shift+Enter → newline. While mention
  popover is open, Enter is swallowed (popover handles it).
- Paste image → upload to staging, add chip.
- Paste text containing a Figma URL → set `detectedFigmaUrl`, add chip.
- Drop image → upload + chip.
- Type `@` at a word boundary → mention popover opens with `@Computer` as
  the only allowed option on the homepage. (Mention popover gets a
  `scope?: "home" | "project"` prop; `filterMentions` filters out
  frame-scoped tokens when `scope === "home"`.)
- Autofocus: on mount, the textarea gets focus (skippable if there are
  projects and the user might want to click one — decide during
  implementation review; default on).

`submit()`:
1. If `text.trim()` empty or `busy`, no-op.
2. Call `props.onSubmit({ prompt, imagePaths, figmaUrl })`.
3. `HomePage` handles the rest (project create, adoption, navigation). The
   hero input stays populated until the caller resolves successfully, at
   which point the composer is cleared.

### `ProjectsSection`

Props:

```ts
interface ProjectsSectionProps {
  projects: Project[]; // from useProjects()
  onOpen: (slug: string) => void;
  onRename: (p: Project) => Promise<void>;
  onDelete: (p: Project) => Promise<void>;
}
```

Behavior:
- If `projects.length === 0` → return `null` (no heading, no empty state).
- Heading: `<h2>Projects</h2>`, Title2 style (`Chip_Display_Variable
  Semibold`, 27px), `var(--fg-neutral-prominent)`. `margin-bottom: 16px`.
- Grid: `grid-template-columns: repeat(3, minmax(0, 1fr))`, `gap: 16px`.
- Each cell: existing `<ProjectCard>`. Card height stays at today's value
  (adjust only if the Figma comparison in review shows a meaningful gap).

### `HomePage`

Replaces `ProjectList.tsx`.

```tsx
export function HomePage({ onOpen }: { onOpen: (slug: string) => void }) {
  const { projects, refresh } = useProjects();
  const { toast } = useToast();
  const { set: setPending } = usePendingPrompt();
  const [submitting, setSubmitting] = useState(false);

  async function handleHeroSubmit({ prompt, imagePaths, figmaUrl }) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const name = deriveProjectName(prompt);
      const p = await api.createProject({ name, theme: "arcade", mode: "light" });
      let finalPaths = imagePaths;
      if (imagePaths.length > 0) {
        const res = await api.adoptUploads(p.slug, imagePaths);
        finalPaths = imagePaths.map((old) => res.mapping[old] ?? old);
        if (res.missing.length > 0) {
          toast({ title: `Couldn't attach ${res.missing.length} image(s)`, intent: "alert" });
        }
      }
      setPending({ prompt, imagePaths: finalPaths, figmaUrl });
      void refresh();
      onOpen(p.slug);
    } catch (e) {
      toast({ title: "Failed to create project", description: String(e), intent: "alert" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <StudioHeader title="Studio" right={<AppSettingsButton />} />
      {/* handleRename / handleDelete lifted unchanged from the old ProjectList */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "120px 24px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 160,
        }}>
          <HeroPromptInput onSubmit={handleHeroSubmit} disabled={submitting} />
          <ProjectsSection
            projects={projects}
            onOpen={onOpen}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </div>
      </div>
    </div>
  );
}
```

`deriveProjectName(text: string): string`:
- Trim whitespace.
- If empty → `"Untitled project"`.
- If length ≤ 40 → return as-is.
- Else: take first 40 chars, cut at the last word-boundary ≤ 40 chars, trim,
  append `…`. If there's no whitespace in the first 40 chars, hard-cut at 40
  and append `…`.

## API additions

### `POST /api/uploads/_staging`

Body: raw image bytes. Header: `Content-Type` (image/*).
Response: `{ path: "/uploads-staging/<sessionId>/<filename>", url: string }`.

- `sessionId` is taken from cookie `studio_staging_session`, minted if
  absent, TTL 7d.
- Max size and mime-type validation mirror the existing per-project upload.

### `POST /api/projects/:slug/adopt-uploads`

Body: `{ paths: string[] }` — staging paths previously returned by
`/api/uploads/_staging`.
Response:
```json
{
  "mapping": { "<oldStagingPath>": "<newProjectPath>" },
  "missing": ["<oldPath>", ...]
}
```

Moves files via `fs.rename` (same device) or `fs.copyFile` + `fs.unlink`
fallback. Never clobbers: if the destination filename exists, appends a
counter suffix.

### Staging cleanup

`studio/server/plugins/*` gets a small cleanup routine run on dev-server
start: remove any `uploads-staging/<sessionId>/` folder last-modified > 24h
ago. Silent failures, logged only.

## Testing

### Component tests

`__tests__/components/hero-prompt-input.test.tsx`:
- Placeholder is rendered at 50px with opacity 0.48 when empty.
- Typing advances the font-shrink state (mock `scrollHeight`, assert
  `font-size` steps down).
- Typed text rendered at opacity 1.
- `@Computer` typed → mention popover opens; selecting inserts `@Computer `.
- Paste a Figma URL → Figma chip appears.
- Paste an image (mock blob) → upload hits `/api/uploads/_staging`.
- Send disabled when `text.trim()` empty; enabled otherwise.
- Enter submits; Shift+Enter adds newline.

`__tests__/components/projects-section.test.tsx`:
- Empty projects → renders nothing.
- Non-empty → renders heading and one `ProjectCard` per project.

`__tests__/routes/home-page.test.tsx`:
- Hero submit creates a project (mock `api.createProject`), adopts uploads
  (mock `adoptUploads`), stashes a pending prompt, and calls `onOpen`.
- On create failure, toast fires and prompt stays in the hero.
- On partial upload adoption failure, project still opens; toast fires with
  a count.

### Server tests

`__tests__/server/staging-uploads.test.ts`:
- Round-trip: POST staging → receive path → POST adopt → file moved to
  project folder.
- Session isolation: files written under `sessionA` aren't adoptable from
  `sessionB`.
- Missing paths in adopt → reported in `missing` array, doesn't throw.

### Shared-hook test

`__tests__/hooks/use-prompt-composer.test.ts`:
- `projectSlug=undefined` routes uploads to staging endpoint.
- `projectSlug="foo"` routes to `/api/uploads/foo`.
- `onPaste` detects and stores Figma URLs.

## Rollout

This is a straight replacement of the homepage. No feature flag — the old
"+ New project" button and search bar go away in the same PR that ships the
hero input. The per-project chat pane is unchanged, so beta testers always
have a path to prompt even if the hero has a bug; worst case someone opens
an existing project and prompts there.

Version bump to `0.7.0` (feature, user-visible homepage shift). Changelog
entry under `## [0.7.0]` with Added / Changed lines.

## Open questions / follow-ups

- `deriveProjectName` edge case: prompts in non-Latin scripts. 40 chars is a
  reasonable cap in any script, but the word-boundary fallback relies on
  `\s` — fine for CJK if we accept zero-width breaks at nothing, at which
  point we hard-cut at 40. Revisit if testers surface legibility issues.
- `@Computer` on the home page: the mention is preserved into the first
  turn. The current middleware handles `@Computer` mentions in-project — we
  assume first-turn behavior is identical, but verify during
  implementation that the downstream path doesn't assume pre-existing
  chat history.
- Autofocus on mount when the project list is non-empty: may steal keyboard
  focus from users who intended to click a card. Re-evaluate in review with
  a screenshot.
