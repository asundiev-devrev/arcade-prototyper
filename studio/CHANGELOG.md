# Changelog

All notable changes to Arcade Studio. Versions follow [semver](https://semver.org/)
where we can; pre-1.0 the minor number is the "meaningful batch of work" counter
and the patch is reserved for quick follow-up fixes.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.11.0] — 2026-05-06

### Added
- Generator now ends every response with a required `### Deviations` section listing where the frame deviated from the design system (hand-rolled chrome, off-token colors, invented props, `{/* TODO */}` gaps). Designers see all deviations inline instead of relying on the agent's discretion.

### Changed
- System prompt reshaped around a strict response shape: one-sentence summary + bulleted deviations. Verbose technical narration ("I read the manifest, then wrote the file…") is suppressed.

### Fixed
- When the generator skips the deviations contract, the chat now shows a visible warning trailer instead of silently letting the omission through.

## [0.10.0] — 2026-05-06

### Changed
- **Streaming is now server-owned and survives refresh.** Turn state used
  to live entirely in the React hook, which meant a page reload or a
  home-to-project navigation lost the stream until the agent's final
  bubble appeared. The server now keeps every turn in an in-memory
  per-slug registry: `POST /api/chat` starts the turn and returns `202`
  immediately, and a new `GET /api/chat/stream/:slug` SSE endpoint
  replays every buffered event then follows the live tail (with
  heartbeats and 5-minute retention after `end`). The client always
  subscribes on mount and reconnects on drops. Concrete effects:
  - New project from the home prompt shows streaming from event #1 —
    no more "prompt appears but the chat stays silent until the first
    frame lands".
  - Refreshing mid-turn rehydrates the full activity timeline and
    continues streaming live instead of going dark until completion.
  - A persistent "Working… 0:23" row (turning into an error banner on
    failure) replaces the ephemeral "Thinking…" so it's always clear
    whether the agent is still cooking.
- **`pendingPromptContext` is gone.** The home page now starts the
  chat turn via the same `POST /api/chat` before navigating, so the
  project page simply subscribes to an already-live turn on mount.
  Previously we deferred the first send to a `setTimeout(0)` inside
  the chat pane's mount effect to dodge StrictMode double-mounting —
  that whole dance is no longer needed.

### Fixed
- **Settings gear no longer appears in the project header.** Settings
  are global; rendering the icon on each project header implied
  per-project settings existed.
- **Multiple frames in the viewport are visually separated.** Adjacent
  frames used to blend into one continuous surface because both
  inherited the canvas background. A subtle stroke now delineates each
  frame so it's clear where one ends and the next begins.
- **Clean builds no longer carry a `-dirty` suffix.** `studio/tmp/` is
  scratch space that packaging scripts write to during a build; it's
  now ignored by git so the commit-SHA stamp sees a clean tree and
  drops the `-dirty` marker from the version label.

## [0.9.0] — 2026-05-05

### Changed
- **Lift Manifest is now XML instead of Markdown.** `LIFT.md` is gone;
  each frame now gets a `LIFT.xml` next to its source (plus the
  unchanged `LIFT.json` machine-readable companion). The "Copy Lift
  Manifest" button now puts XML on the clipboard. The HTTP endpoint
  moved from `/api/projects/<slug>/lift/<frame>.md` to
  `/api/projects/<slug>/lift/<frame>.xml`; the Vercel share bundle
  ships `/lift/<frame>.xml`. The rationale: the primary consumer is
  Claude Code in a `devrev-web` session, and Claude extracts
  XML-tagged sections (`<frame_inventory>`, `<scaffolding>`,
  `<agent_directives>`, …) more reliably than markdown headings —
  which is Anthropic's own guidance for structured prompt context.
  Early-adopter engineers' first handoffs confirmed the uneven
  markdown behavior was real, not theoretical.
- **Stale `LIFT.md` files are cleaned up on the next frame write.** Users
  upgrading from 0.8.x will see the old `.md` file disappear the next
  time Studio regenerates a manifest (or on next launch, via the
  cold-start walk).

## [0.8.2] — 2026-05-05

### Fixed
- **Copy Lift Manifest now returns the manifest, not `project.json`.**
  The projects middleware had a greedy catch-all that matched any URL of
  the form `/api/projects/<slug>/...`, extracted the slug, and returned
  project metadata — clobbering the Lift Manifest route (and every other
  `/api/projects/<slug>/<subresource>` endpoint). It now handles only the
  exact root and slug-only routes and falls through to the next
  middleware for anything deeper, so `liftMiddleware`, `thumbnailsMiddleware`,
  and friends actually run. Two regression tests pin both the fall-through
  and the kept happy path.
- **Lift Manifest primitives are no longer all `_unmapped_`.** The mapping
  table is keyed on the `"arcade"` specifier, but the generator's prompt
  template instructs frames to import from `"arcade/components"`. Both
  resolve to the same `prototype-kit/arcade-components.tsx` barrel at
  build time, so the lift parser now normalizes `"arcade/components"` to
  `"arcade"` before the lookup.

## [0.8.1] — 2026-05-05

### Fixed
- **Undefined JSX components no longer slip into frames.** The
  `validateArcadeImports` PostToolUse hook now also scans JSX for
  capitalized tags that aren't imported or declared in the same file,
  blocking the Write with Did-you-mean suggestions instead of letting a
  runtime `ReferenceError: <Foo> is not defined` surface to the viewport.

## [0.8.0] — 2026-05-05

### Added
- **Lift Manifest.** Every frame now gets a `LIFT.md` and `LIFT.json`
  written next to `index.tsx`, plus a "Copy Lift Manifest" button in the
  Share modal. The manifest maps every arcade-gen import in a frame to
  its production `raw-design-system` equivalent (with prop deltas and
  structural notes), detects the frame's shape (list-view, settings-form,
  detail, ad-hoc) to surface a production-scaffolding checklist, and
  flags any imports with no mapping entry. Served locally at
  `/api/projects/<slug>/lift/<frame>.(md|json)` and bundled into Vercel
  share deployments at `/lift/<frame>.(md|json)` so an engineer can grab
  a manifest from a shared URL without installing Studio. The mapping
  table lives under `studio/src/lift/mappings/` and is enforced by a
  coverage test that fails loudly when a prototype-kit composite or
  arcade-gen primitive drifts without a mapping entry. On Studio start,
  manifests are also backfilled for every pre-existing frame so the new
  button works out of the box.

## [0.7.0] — 2026-05-04

### Added
- **Branded homepage with a hero prompt input.** Type what you want to build
  and hit send — Studio creates a new project named after your prompt and
  fires the first turn automatically. The hero textarea is borderless, uses
  the Chip display font, autofocuses on mount, and progressively shrinks
  (50px → 20px in discrete per-line steps) as the prompt gets longer.
- **Model selector** in the hero input, rendered as a compact pill. Reads
  and writes the same `studio.model` setting as the Settings modal.
- **Staging uploads.** Images pasted, dropped, or picked before a project
  exists go to `POST /api/uploads/_staging` and get adopted into the new
  project via `POST /api/projects/:slug/adopt-uploads` on submit.
- **`@Computer` mentions, Figma URL detection, and image attachments** all
  work on the homepage's hero input, same surface as the in-project chat.

### Changed
- **Project list** now sits below the hero as a compact 3-column gallery
  with no thumbnails. Cards show name + date anchored to the bottom-left
  and a Rename / Delete menu behind a tertiary `⋯` button in the
  top-right. The explicit "+ New project" button and search input on the
  homepage have been removed — the hero input replaces both creation
  paths.
- **Settings PATCH is now a deep merge.** Previously a shallow top-level
  merge meant touching `studio.*` could accidentally drop sibling keys
  (e.g., selecting a model would wipe `studio.mode`). Patch now recurses
  into plain objects, and `null` is the explicit-unset convention.
- **Upload MIME validation** is anchored and parameter-stripped on both
  the staging and per-project endpoints, closing a loophole where a
  header like `text/plain; fake=image/png` could slip through.

### Fixed
- **Pending first-turn prompt is StrictMode-safe.** The hero's first
  prompt is handed to `ChatPane` via a one-shot context; the consume
  runs inside a microtask the first cleanup cancels, so the second
  StrictMode mount is the one that actually fires `send`.
- **`adoptUploads` closes the collision race** via exclusive destination
  reservation, and the EXDEV cross-device fallback now surfaces unlink
  failures instead of leaving orphan files in staging.
- **Mention popover reanchors** on scroll and resize while open, so it
  follows the hero input instead of drifting when the page moves.

## [0.6.0] — 2026-05-03

### Added

- **Point-to-prompt targeting.** A new crosshair IconButton on the
  frame toolbar switches the frame into "pick" mode. Hover highlights
  the element under the cursor with a blue outline; click it and the
  element is added to the chat input as a context chip showing its
  component name and source file:line. The next prompt is
  automatically prefaced with a structured reference to that element,
  so the agent knows to scope its edits to it.
- **Targeting state on the button.** The picker button reflects
  three states: idle (secondary), picking (primary + Esc to cancel),
  and targeted (primary + click-to-clear). A success toast fires when
  an element is picked; a failure toast explains why if the pick
  can't be resolved.
- **Visual feedback on click.** The hover outline briefly flashes
  green on a successful pick (red on failure) before the overlay
  clears, so the user sees the result of their click.

### Notes

- Targeting works against React 19's new `_debugStack` (not the
  removed `_debugSource`). Dev-only by design — the feature relies on
  React fibers and would not survive a production build.

## [0.5.1] — 2026-05-03

### Added

- **Open frame in a new tab.** A subtle secondary IconButton sits on
  the same row as the frame name and width, pushed to the right.
  Click it to open the rendered frame in a separate browser tab —
  useful for full-window preview or devtools debugging.

### Removed

- **"Refine against reference" feature.** The button that sent the
  latest chat reference image + a fresh frame screenshot to a second
  Claude pass has been removed. The server middleware
  (`/api/projects/:slug/frames/:frame/critique`) and the headless
  chromium screenshot helper are gone too. The dependency on
  `puppeteer` that this feature required is no longer pulled at dev
  time.

## [0.5.0] — 2026-05-03

### Added

- **Resizable chat pane.** Drag the right edge of the chat pane to
  widen or narrow it; double-click the handle to reset. The width
  is remembered per-install in localStorage.
- **Drag-to-resize frame handle.** The viewport's device-preset
  toggle has been replaced with a direct drag handle on the right
  edge of the frame — resize the frame to any width instead of
  picking from a fixed preset.
- **Markdown in Claude Code replies.** Assistant bubbles now
  render markdown (headings, lists, inline code, bold/italic)
  instead of a wall of plain text.

### Changed

- **Chat toggle moved into the header.** The collapse/expand
  control for the chat pane now sits to the left of the project
  picker (stable position regardless of pane state) and uses the
  `DotInLeftWindow` icon from arcade-gen.
- **Header icon buttons refreshed.** Canvas toggle now uses
  `DotInRightWindow` mirroring the chat toggle. Share, settings,
  and canvas toggle all use the lighter `tertiary` variant in
  their default state.
- **Generator no longer emits `size="sm"` buttons and icons.**
  An arcade-components shim narrows the Button/IconButton types so
  the generator can't write `size="sm"`, and a runtime guard
  ignores it if older frames do. Icons inside IconButton are also
  constrained so the generator can't accidentally produce giant
  icons. See `studio/docs/plans/` for the full design.

### Fixed

- **Update-check points at the public mirror.** `GET /api/version/check`
  now polls `asundiev-devrev/arcade-studio-releases` instead of the
  private source repo, so unauthenticated launches actually see new
  releases. (Was a 0.4.5 follow-up that never made it into a DMG.)

## [0.4.5] — 2026-05-01

### Added

- **Update-available banner.** Studio now checks GitHub once per
  launch (cached an hour server-side) and shows a dismissable banner
  when a newer release is published. Click "Download" opens the DMG
  asset in your browser; install the usual way. The banner
  remembers your dismissal per-version, so it won't nag again for
  the same release.
- `GET /api/version/check` — thin wrapper around the GitHub releases
  API; fails quiet when the API is unreachable so offline launches
  don't get a spurious warning.

## [0.4.4] — 2026-05-01

### Fixed

- **AWS sign-in is now checked before you can type a prompt.**
  Previously, if your SSO credentials weren't valid, the first time
  you'd hear about it was after sending your first prompt — which
  lost the prompt and was baffling onboarding. Studio now probes
  `/api/aws/status` on launch and blocks the app behind a modal with
  a "Sign in to AWS" button until you're authenticated. No more
  typing into a broken shell.

## [0.4.3] — 2026-05-01

### Fixed

- **Hallucinated icon imports no longer reach the browser.** The
  generator sometimes writes imports like `ArrowsUpDownSmall` that
  don't exist in `arcade/components`, and the frame renders blank
  with a load error. A new PostToolUse hook runs on every `Write` /
  `Edit` and checks named imports from `arcade/components` and
  `arcade-prototypes` against the real barrels. On a bad name it
  exits 2 with a `did you mean …` message, and the model
  self-corrects in the same turn — no more broken frames from this
  class of typo.

## [0.4.2] — 2026-05-01

### Fixed

- **Figma context now actually reaches the generator on first-time
  URLs.** 0.4.1 was silently failing: the composite classifier takes
  ~40 s end-to-end, the chat middleware only waited 10 s for the whole
  ingest, so the first turn on a URL hit the miss path and generated
  with no Figma context at all. Split the ingest into a fast phase 1
  (tree + tokens + PNG, ~3–8 s) the chat turn waits for, and a slow
  phase 2 (classifier) that runs in the background and upgrades the
  cache entry in place. First turn now gets tree + PNG; the next turn
  on the same URL gets composite hints too.

### Changed

- Figma ingest logs split across two lines so you can see both phases:
  `[figmaIngest] phase=1 … nodes=N warnings=K` and `phase=2 … composites=M`.

## [0.4.1] — 2026-05-01

### Fixed

- **Figma ingest no longer times out the composite classifier on real
  files.** Haiku needs 20–40 s to digest a full sidebar-sized tree; the
  previous 15 s budget SIGTERM'd it almost every time, so the
  "Figma context: 0 composites suggested" narration was silently the
  norm. Raised to 60 s.
- **Depth cap raised from 8 to 12.** Real Figma frames (sidebars,
  toolbars) are routinely 9–11 deep after our compact/collapse pass;
  at 8, interior sections were truncated before the classifier saw
  them.
- **Projects list no longer spams "Invalid slug: _figma-ingest".** The
  PNG scratch directory moved from `projects/_figma-ingest/` to a
  sibling `.figma-ingest/` location so the watcher stops scanning it
  as a project.
- **Figma ingest now logs a structured success line** to the server
  console: `[figmaIngest] fileKey=X nodeId=Y ms=Z nodes=N composites=M
  warnings=K`. The spec required it; it wasn't wired up in 0.4.0.

## [0.4.0] — 2026-05-01

### Added

- **Figma references are now ingested as structured context** before
  generation. When you paste a Figma URL, Studio silently prefetches
  the document tree, asks a quick classifier which `prototype-kit`
  composites fit, and attaches a frame PNG — all in parallel while
  you're still typing. The generator no longer has to reverse-engineer
  layout from pixels. Falls back to the URL-only behavior if Figma
  auth is missing.

### Changed

- Studio now auto-exports a PNG of the referenced Figma node and attaches
  it to the chat turn (previously users had to paste a screenshot
  themselves).

### Known limitations

- Design-system tokens are not yet resolved — the generator receives raw
  hex fills because `figmanage` has no `get-variables` command. A future
  release will call Figma's REST API directly to close this gap.
- The composite classifier can time out on very deep trees; when that
  happens the tree + PNG still reach the generator but no composite
  suggestions are attached.

## [0.3.1] — 2026-05-01

### Fixed

- **Frames generated by the agent now show up reliably.** Previously,
  if the file-system watcher missed the write (fast enough generator,
  APFS quirk, startup race), the new frame existed on disk but the
  viewport stayed stuck on the empty-state prompt and no amount of
  refreshing or restarting helped. The project API now reconciles
  frames on every read, so the next poll from the UI recovers on its
  own.

## [0.3.0] — 2026-04-30

### Added

- **AWS CLI is now bundled in the DMG.** Fresh-Mac beta testers no
  longer need to `brew install awscli` before their first chat turn.
  Adds ~90 MB to the DMG but replaces the most common onboarding
  blocker with zero-touch setup.
- **"Sign in to AWS" button** on the expired-session banner. When a
  chat turn fails because your Bedrock creds ran out, click the
  button instead of opening Terminal — studio spawns
  `aws sso login --profile dev` for you, the browser tab opens, you
  approve, and you're back. No Terminal required for the hourly
  re-auth anymore.
- **Changelog and "What's new" link** (this file). Settings footer
  shows the current version and a link to these release notes.

### Changed

- Launcher adds the bundled AWS CLI to PATH *after* any
  system-installed one, so users with their own aws setup keep using
  it.

## [0.2.0] — 2026-04-30

First version with a version number. Before this, builds were distinguishable
only by file mtime — which made beta debugging harder than it needed to be.
Everything below has shipped in the last couple of weeks; this entry
backfills the highlights so the "What's new" list has something to point at.

### Added

- **Vercel share deploys work end-to-end.** Generated frames can now be shared
  as public Vercel URLs. Bundles Tailwind per frame, inlines DevRev fonts as
  data URLs (the CDN referer-blocks `*.vercel.app`), and auto-disables SSO
  protection on each new project.
- **Figma integration, now with a PAT input in Settings.** Paste a Figma
  personal access token; studio validates it against the Figma API and
  stores it via figmanage. Previously the "Connect Figma" button tried to
  run an interactive CLI with closed stdin and silently failed.
- **AWS Bedrock bootstrap is one command.** On first launch, the app writes
  DevRev's SSO profile into `~/.aws/config` and spawns all child processes
  with `AWS_PROFILE=dev`. New beta testers only need to run
  `aws sso login --profile dev` once.
- **Build versioning.** DMG filename, Settings footer, Finder Get Info, and
  the launcher log all show the current version + git SHA.

### Fixed

- **Agent errors no longer hang on "Thinking…".** When Claude's Bedrock creds
  expire mid-turn, the error ("run `aws sso login`") surfaces in the chat
  immediately instead of after a 4-minute stall.
- **Generated frames on Vercel now match the studio preview.** Tailwind v4
  is compiled per-frame with `@source` pointing at the frame's code, so
  classes like `pt-12`, `text-title-3`, and arbitrary values like
  `max-w-[832px]` actually exist in the deployed CSS.
- **Fonts load on shared deploys.** DevRev's font CDN rejects requests from
  `*.vercel.app` via referer whitelist; fonts are now base64-inlined into
  the CSS bundle at build time.
- Shared Vercel URLs no longer serve raw base64, and no longer serve the
  Vercel SSO login wall instead of the frame.

### Changed

- Figma PAT now lives in Settings → Figma integration, alongside DevRev
  and Vercel. The standalone "Connect Figma" button in the header is gone.

### Known issues

- `aws sso login` still has to be re-run every ~8 hours (AWS SSO session
  TTL; nothing studio can work around).
- If your mac doesn't have the AWS CLI installed, you'll hit
  `aws: command not found`. Next release bundles it in the DMG.
