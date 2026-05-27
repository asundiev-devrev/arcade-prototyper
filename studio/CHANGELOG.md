# Changelog

All notable changes to Arcade Studio. Versions follow [semver](https://semver.org/)
where we can; pre-1.0 the minor number is the "meaningful batch of work" counter
and the patch is reserved for quick follow-up fixes.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.22.3] — 2026-05-27

### Fixed
- **Frames generated in previous Studio sessions now sync to guests on
  reconnect.** The replay buffer is in-memory, so every host restart
  wiped knowledge of frames that already lived on disk. Combined with
  the file watcher's `ignoreInitial: true`, this meant guests could
  only ever see frames generated *after* both sides were online at the
  same time. Studio now seeds the replay buffer from disk at boot for
  every shared project the host owns, so a guest who joins later gets
  the full frame set via `cache_replay`.

## [0.22.2] — 2026-05-27

### Fixed
- **Frames generated before any guest connects now actually reach the
  guest's mirror.** The host's relay-side replay buffer was created
  lazily on the first guest WebSocket connection, which meant every
  frame the host wrote before that point was silently dropped. Late-
  joining guests then saw an empty viewport even when the host had
  generated dozens of frames. The buffer is now materialized on first
  write, so guests joining later get the full set via `cache_replay`.

## [0.22.1] — 2026-05-27

### Fixed
- **Shared-project viewport is no longer blank when no frames have arrived
  yet.** The guest view used to render nothing under the offline banner,
  which made it look like the page was broken. It now shows an
  empty-state card explaining what to expect (host status, when frames
  will sync) so guests don't think they're staring at a stuck screen.
- **Comments sidebar shows actual comments instead of a JSON dump of every
  relay event.** Filters the event stream to `comment_posted` and renders
  display name + text only. Frame-write/presence noise stays out of the
  reader's way.

## [0.22.0] — 2026-05-27

### Changed
- **Studio is now a real Electron app instead of a bash launcher + browser tab.** Double-click opens a dedicated window. No more "did I close the tab or quit the app?" confusion. Cmd-Q quits the whole thing — Vite child dies cleanly with the window. Native menu bar (File/Edit/View/Window/Help — Electron's defaults; custom menu coming later if useful).
- **In-app auto-update.** First launch on 0.22.0 polls the public mirror for newer versions. When a new release lands, you'll see a "Quit and install" prompt — no more downloading DMGs by hand. Powered by `electron-updater` against the same `asundiev-devrev/arcade-studio-releases` repo the old "update available" banner used.
- **Build chain swapped to `electron-builder`.** The 11-script bash chain (`build.sh`, `dmg.sh`, `codesign.sh`, `notarize.sh`, `notarize-app.sh`, `install-deps.sh`, `copy-sources.sh`, `download-{node,awscli,cloudflared}.sh`, `launcher.sh`) is replaced by a single `electron-builder.yml` declarative config. `pnpm run studio:pack` and `pnpm run studio:release` work the same — the implementation under the hood just changed.
- `metadata.json.relayUrl` in shared-project mirrors is now an optional
  hint, used only as a fallback when the Worker has no current
  rendezvous (legacy 0.20.x mirrors). New mirrors imported under 0.22+
  omit it entirely.
- Offline banner copy: "Gil is offline — viewing cached state." → "Gil
  hasn't been online recently — viewing cached state. New comments will
  be sent when they're back."

### Fixed
- **Multiplayer survives host Studio restarts.** Quick-tunnel hostnames
  (`*.trycloudflare.com`) regenerate every time the host restarts Studio,
  which previously left every guest's mirror permanently offline until
  the host re-shared the project. The host now publishes its current
  relay URL to the share Worker on every tunnel acquire and on every
  Studio boot; guests look it up before connecting and on every
  reconnect attempt, so a host restart is invisible to a guest beyond a
  brief offline blip.
- **"Deploy failed: 400" when sharing a frame to Cloudflare Pages.** The
  multiplayer invite middleware introduced in 0.18.x claimed
  `POST /api/projects/:slug/share` for adding a collaborator, which
  collided with the pre-existing Cloudflare deploy route on the same
  path. The collaborator middleware ran first and rejected the deploy
  body for missing `devu`, surfacing as a generic 400 in the Share
  modal. The collaborator routes are now mounted under
  `/api/projects/:slug/collaborators` instead, so frame deploys reach
  the Cloudflare middleware again. Added a regression test asserting
  `projectSharing` does not intercept `/share`.

### Added
- New share Worker routes `POST /rendezvous/:shareId` and
  `GET /rendezvous/:shareId`, backed by Workers KV with a 7-day TTL.
  Authenticated with the same `ALLOWED_KEYS` Bearer keys as `/share`.
- A `pnpm run worker:deploy` script that lints `wrangler.toml` for the
  KV namespace placeholder before delegating to `wrangler deploy`.

### Migration notes
- Drag the old `Arcade Studio.app` to the trash before installing 0.22.0. Bundle ID is the same (`ai.devrev.internal.ArcadeStudio`), so projects/settings persist via `~/Library/Application Support/arcade-studio/`. macOS may re-prompt once for keychain access (Electron's signature differs from the bash launcher's).
- Bundle is bigger: ~400 MB DMG vs the previous ~270 MB. Electron runtime (~150 MB) is the cost of the native window. Trade is worth it for the UX gain.

### Operator notes
- One-time: provision the new KV namespace
  (`wrangler kv namespace create RENDEZVOUS`), paste the id into
  `studio/worker/wrangler.toml`, then redeploy with
  `pnpm run worker:deploy`.
- Existing 0.20.x guests don't need to re-import; the next time the
  host launches 0.22.0 their mirror auto-upgrades on the next reconnect
  attempt.

### Note on 0.21.x
- The 0.21.0 / 0.21.1 tags on the public mirror were the in-progress
  Electron migration shipped from a separate branch and never merged
  to main. 0.22.0 supersedes both — install 0.22.0 directly.

## [0.20.1] — 2026-05-15

### Fixed
- **"Arcade Studio is damaged and can't be opened" on first launch.** The 0.20.0 DMG was notarized, but the `.app` inside wasn't — Gatekeeper's deep-verify at runtime failed because the notarization receipt didn't transfer from the DMG into the bundle. The build now submits the `.app` itself to Apple notarization and staples the receipt onto the bundle BEFORE wrapping it in the DMG. Both `.app` and DMG are now stapled.

### Workaround for users who tried 0.20.0
If you installed 0.20.0 and hit "damaged", Gatekeeper has cached a bad verdict on the bundle that survives even after installing a clean 0.20.1. To clear it:

1. Drag `Arcade Studio.app` out of `/Applications` to the Trash.
2. In Terminal:
   ```
   xattr -cr ~/Downloads/Arcade\ Studio.app   # if downloaded
   ```
3. Reinstall the 0.20.1 DMG to `/Applications` via Finder drag-and-drop.
4. Double-click to open.

If macOS still says "damaged", install to a fresh path first to bypass the cached verdict:
```
mkdir -p /tmp/arcade-fresh
cp -R "/Volumes/Arcade Studio/Arcade Studio.app" /tmp/arcade-fresh/
xattr -cr /tmp/arcade-fresh/Arcade\ Studio.app
open /tmp/arcade-fresh/Arcade\ Studio.app
```
Once that opens cleanly, you can move it to `/Applications`.

Fresh users (never installed any prior version) get a clean install with no workaround.

## [0.20.0] — 2026-05-15

### Added
- **Multiplayer is now a property of the project, not a one-shot session.** Share a project with a DevRev teammate once and it appears on their Studio homepage as a tile. They can open it, watch frames stream live while you're working, and post comments. Closing their tab no longer ends the session — re-opening picks back up. When you go offline, they see the cached last-seen state plus a banner. Comments composed while you're offline queue locally on their disk and flush on reconnect.
- **Share panel** in the project header lists current collaborators and lets you add or remove them. Adding still sends a Computer DM with a clickable link, just pointing at `/project/<id>` instead of the old `/join/<id>` route.
- **Presence strip** in the project header shows avatar dots for everyone currently watching (host + connected guests).
- **Comment-only chat** for guests in shared projects. Guest's chat input only produces comments — frame builds stay host-driven.
- **`@`-mention shortcut in chat** now routes through the share endpoint with a confirmation prompt for new collaborators (instead of creating a per-mention session).

### Changed
- Wire protocol: `session_state` event replaced with `presence_state` (host + guests) and `cache_replay` (chat tail + latest frames per path) on join. Allowlist enforcement happens at WebSocket upgrade against the project's `shared_with` list. New `comment_posted` command/event for guest comments.
- `sessions.json` migrates to `projects.json` on first launch (one project per `(host, slug)` pair, deduped from sessions). Legacy `sessions.json` is left in place for one release as a safety net.
- Cloudflare tunnel is refcounted across projects — multiple shared projects share one cloudflared process; tunnel stops when the last collaborator is removed.
- Worker landing page at `/project/<id>` joins existing `/join/<id>` (kept one release for 0.18.x clients). Both use the 18-second progressive retry from the 0.18.6 fix.
- macOS deep-link forwarding switched from `#join=` to `#share=` hash. The frontend hook still understands both for one release.

### Known limitation
- Frame rendering on the guest side uses an iframe `srcDoc` v1 stand-in. Host frames are JSX, so what guests see is the raw template text rather than the rendered prototype. Real bundle-and-render path is the next follow-up.

## [0.18.6] — 2026-05-14

### Fixed
- **Invite link in the Computer DM is now clickable.** The message body wraps the URL in `[Join the session](<url>)` markdown syntax — Computer's DM renderer interprets that and turns it into a proper clickable link. Plain URLs (what we had before) were shown as inert text, so the recipient had to copy/paste the link to open the invite.

### Known limitation
- Invites still don't trigger Computer's unread-badge / desktop notification for the recipient. The DM lands in their inbox and they can see it once they open the thread, but nothing prompts them that a new invite arrived. Appears to be a side effect of how `timeline-entries.create` via PAT auth interacts with Computer's notification pipeline — we'll investigate separately.

## [0.18.5] — 2026-05-14

### Fixed
- **0.18.4 broke tunnel creation.** Dropping cloudflared to `--loglevel warn` silenced the URL announcement too — the trycloudflare URL is logged at INFO level. Our 30s parse window timed out, and every invite failed with "Failed to fetch." Reverted the log-level flag. The stream-listener detach after URL parse (which also aimed at the dock-bounce) stays — that's still likely valuable on its own.

## [0.18.4] — 2026-05-14

### Fixed
- **`@`-mention no longer fires a chat turn.** Sending `@konstantin check this out` used to invite Konstantin AND kick off a normal chat turn — the agent would try to interpret "check this out" as a design prompt and emit a "no frame to build" deviations response. Now `@`-mentions are invite-only: the invite fires, a system message appears inline in the chat transcript ("Invited Konstantin to this session..."), and the chat turn is skipped entirely. System messages render as a muted centered row, not a speech bubble.
- **Dock icon no longer bounces for ~10s after the first invite.** Cloudflared was logging 20+ lines at its default `info` level on tunnel creation — on macOS that noise through Studio's Node stderr was enough to trigger Launch Services' "app wants attention" behavior. Running cloudflared with `--loglevel warn` and detaching the stream listeners after the URL is parsed quiets the pipe.

## [0.18.3] — 2026-05-14

### Fixed
- **Invite flow no longer crashes Studio when cloudflared is missing.** Spawning a missing binary on macOS doesn't throw synchronously — it returns a ChildProcess and emits an asynchronous 'error' event. Our tunnel manager didn't have an 'error' handler attached, so the ENOENT took down the whole Vite process on the first invite attempt. The invite now rejects cleanly with a descriptive error.
- **DMG now bundles cloudflared.** Users no longer need to `brew install cloudflared` themselves — the binary (~23 MB, Darwin-native for the DMG's target arch) is fetched during build and shipped alongside node + awscli. Host-installed cloudflared still wins in $PATH for anyone who prefers their own version.

## [0.18.2] — 2026-05-14

### Fixed
- **Mention popover now sees the whole org.** DevRev's `dev-users.list` API returns ~4,000 rows across 8 cursor pages; the previous code grabbed only the first 500 and silently truncated, which hid anyone past `K` alphabetically (Konstantin, Athila, etc. were invisible). New server-side helper paginates all pages once, filters to active @devrev.ai humans (~200 people out of 4k), and caches the result for 10 minutes — the popover stays instant after first open. Exposed via `GET /api/multiplayer/mention-users`.

## [0.18.1] — 2026-05-14

### Fixed
- **Mention popover shows far fewer users.** The `@` popover previously listed all 400 rows DevRev's API returns — including gmail externals, role mailboxes like `dpo@`, `sales-apj@`, contractor `c-*@` accounts, test accounts with `+suffix` emails, and deactivated employees. Filtered down to active @devrev.ai employees only (~112 people). Also stripped the `i-` prefix that imported-identity accounts carry, so `Arvind Bhushan` shows as `@arvind.bhushan` instead of `@i-arvind.bhushan`.
- **Bumped the user-list fetch limit from 200 to 500.** The 200-row cap was silently hiding half the org on the client side — nothing to do with filtering, the API just needs a higher `limit`.

## [0.18.0] — 2026-05-14

### Added
- **Multiplayer invite flow (preview).** `@`-mention a DevRev teammate in the Studio chat input and they receive a real Computer DM with a deep link. Clicking the link launches Studio and prompts them to join the session. The guest reaches a "Connected. Waiting for the host to drive…" state — live event streaming (seeing your prompts and generated frames in real time) is the follow-up work. Technically: Studio spawns `cloudflared` on first invite to expose `localhost:5556`, creates a DevRev chat via `chats.create` with the host as a participant (Spike 2 verified the PAT-auth path), and posts the invite message as a regular timeline entry. The guest's browser WebSocket authenticates via `?pat=<guest PAT>` query string because the browser can't set Authorization headers. The `arcade-studio://` URL scheme is registered in `Info.plist`; the launcher forwards deep links to the running Vite server as a `#join=` hash fragment.
- Internal: in-process WebSocket relay at `/api/multiplayer/ws` with driver-lock arbitration, session persistence, and a pure-logic protocol engine (the foundations the invite flow builds on).

## [0.19.0] — 2026-05-15

### Changed
- Build is now signed with DevRev's Apple Developer ID and notarized by
  Apple. First launch no longer triggers the "unidentified developer"
  Gatekeeper warning. No more right-click → Open dance.
- Bundle identifier changed from `com.devrev.arcade-studio` to
  `ai.devrev.internal.ArcadeStudio`. macOS treats the signed build as a
  separate app from the previous unsigned ones — drag the old
  `Arcade Studio.app` to the trash before installing 0.19.0 to avoid
  having two installed simultaneously.

### Migration notes
- Your projects, settings, and DevRev PAT carry over automatically — they
  live under `~/Library/Application Support/arcade-studio/` and the
  macOS Keychain, both keyed by path/service name rather than bundle ID.
- On first launch of 0.19.0, macOS may prompt you to allow the new app
  to read the existing DevRev PAT from the Keychain (because the
  signing identity changed). Click **Always Allow**.

## [0.17.1] — 2026-05-13

### Changed
- **DMG installer window is now branded and instructional.** The installer window opens at a fixed 800×500 size with the app icon pinned to the left and the `/Applications` shortcut on the right, matching the conventional left-to-right drag-install direction (previously Finder auto-arranged alphabetically, putting `Applications` on the left and forcing a right-to-left drag). A peachy-cream background (`#fceade`, pulled from the Onboarding 3.0 sign-in canvas) sits behind the two icons, with a subtle grey curved arrow between them and a two-line Chip Display Bold caption "Drag Arcade Studio to / Applications to install" in jabuticaba purple. Implemented by building an intermediate UDRW DMG, scripting Finder's window layout via AppleScript, hiding the `.background/` asset directory via `chflags hidden`, and converting to the final compressed UDZO. Source SVG lives at `studio/packaging/dmg-background.svg`; the PNG is regenerated via `rsvg-convert` when the SVG changes.

## [0.17.0] — 2026-05-13

### Added (server-side, no client update needed)
- **Shared frames are now gated by Cloudflare Access one-time PIN, managed through one reusable policy.** Every `/share` call in the Worker creates (or reuses) a Cloudflare Access Application covering that project's `*.pages.dev` hostnames. Each app references a shared reusable policy ("Arcade Studio viewers") by ID, which currently allows `@devrev.ai` emails via the account's default One-time PIN provider. Session TTL = 24 hours. Per-project apps + one shared policy means: adding an external reviewer is a single edit to the policy in the Zero Trust dashboard — propagates to every current and future shared frame immediately, no code change, no redeploy, no per-project clicks. The Worker's `ensureAccessApp` also reconciles: apps created before the shared-policy design land on the right policy automatically the next time their project is shared (PUT to swap `policies`, idempotent if already correct). Requires the Worker's `CF_API_TOKEN` to carry `Account → Access: Apps and Policies → Edit` in addition to the existing Pages scope, and `ACCESS_POLICY_ID` set as a non-secret var in `wrangler.toml`.

### Fixed (server-side, no client update needed)
- **Share Worker was using the wrong Cloudflare API shape.** The first cut tried to POST files + manifest in one multipart request to `/pages/projects/:name/deployments`. Cloudflare returned 200 and a deployment ID, but the actual assets never landed in their asset store — every `pages.dev` URL then served HTTP 500 on read. Fixed by moving to the documented three-step Direct Upload flow: (1) GET `/pages/projects/:name/upload-token` for a short-lived JWT, (2) POST content-addressed base64 payloads to `/pages/assets/upload`, (3) POST the manifest (just `{path: hash}`) to `/pages/projects/:name/deployments` to wire the assets into a new deployment. Worker redeployed — no client rebuild required; existing 0.17.0 installs work immediately against the updated Worker.

### Changed
- **Share-to-web replaced: Vercel → Cloudflare Pages (via a team share Worker).** Studio now deploys frames to the shared DevRev Product & Design Cloudflare account through a small Cloudflare Worker (`studio/worker/`) that holds the real Cloudflare API token as a secret. Teammates paste a per-user share key — not a Cloudflare token — into Settings → "Share to web", so no one has to create their own Cloudflare account and the raw API token never leaves the Worker. The operator keeps the master list of keys in macOS Keychain and uses three scripts to onboard/offboard teammates: `./bin/add-teammate.sh <name>`, `./bin/revoke-teammate.sh <name>`, `./bin/list-teammates.sh`. Each script rebuilds the Worker's `ALLOWED_KEYS` secret from Keychain and redeploys. Newly generated keys are distributed via one-time-paste URLs (e.g. password.link) over Slack DM. See `studio/worker/README.md` for the operator runbook and `studio/docs/cloudflare-setup.md` for the 30-second teammate setup. Existing `vercel.*` settings are ignored; the `deployments` array in `project.json` is preserved as-is (old Vercel URLs stay as historical data).

## [0.16.2] — 2026-05-13

### Changed
- **Lift-manifest improvements informed by the first live render loop.** A 2026-05-12 round trip through typecheck + browser render of a real Studio frame (`01-skills-gallery`) against a real devrev-web checkout exposed three classes of bug that text-level review had missed. Five manifest updates follow:
  - New **`style_attribute_convention`** fires when a frame uses inline `style={{ ... var(--bg-*) / --fg-* / --stroke-* / --border-* / --color-* ... }}` references. Teaches the downstream agent to rewrite those to Tailwind utility classes (preferred) or `border-[hsl(var(--X))]` bracket arbitrary-value form. Leaving them as inline `style` tokens produces black borders and transparent backgrounds at render time because several devrev-web tokens are stored as raw HSL channel triples and silently invalidate when used as a bare `var(--X)` in a CSS color property.
  - New **`<render_harness>`** block emitted on every manifest. Always includes a target-path suggestion, an iframe URL pattern, a backdrop hint (many DS border tokens resolve to near-white and vanish against a pure-white iframe), and a verification checklist the agent runs AFTER writing code — open the page in a browser, read computed styles, confirm real colors instead of `currentColor` fallback. Checks adapt to which conventions fired (inline-style rewrite verify, overlay Modal conversion, icon-enum consumption, etc.).
  - New translation class **`close-but-not-identity`** for mappings that look identity-1:1 on the surface but carry load-bearing propDelta / slotNote guidance (optional-arg callback wraps, signature narrowing, etc.). Tabs moved from `structural` (which implied "write production shape with a brief comment") to this class, so the agent treats per-delta notes verbatim — the `Tabs.onValueChange` optional-arg wrap is no longer a bug waiting to happen. Tracked in a new `closeButNotIdentity` metric bucket that doesn't inflate the decision-points gate.
  - **Drift-audit `token-resolution` category.** For every audited token (fg/bg/stroke/border families), the audit walks the `var(--X)` chain through the target's theme CSS — including multi-level indirections and embedded `var()` substitutions like `--neutral-920: var(--neutral-h) var(--neutral-s) 92%` — and reports any token that terminates in raw HSL channels. Against the live devrev-web clone this correctly fires on five fg/stroke tokens.
  - **Drift-audit `figma-value-drift` category** with a new optional snapshot file at `studio/src/lift/figma-token-values.json` mapping CSS var names to Figma hex values. When populated, the audit cross-checks the target theme's resolved hex against the Figma source and reports divergence — Figma `Border/Outline/00 = #E9E9EC` vs devrev-web `#E9E9ED` is the canonical example. Reported as "platform drift, no manifest change available" rather than as a mapping-table bug.

### Added
- Explicit **`Switch → Toggle` primitive mapping** (prop deltas verified against devrev-web's `toggle.types.tsx`: `defaultChecked → initialChecked`, `onCheckedChange → onChange`). Prior-art anchor at `agent-platform/feature/agent-studio/.../edit-guardrail-modal.tsx`. Two prior live-lift runs of the same modal both re-derived this via `default_mapping_convention`; now encoded once.

### Fixed
- **`Tabs` mapping now warns about the optional-arg `onValueChange` signature.** A live typecheck of the v3 lifted `skills-gallery.tsx` against devrev-web failed with TS2322 on `<Tabs value={activeTab} onValueChange={setActiveTab}>` because production `Tabs.onValueChange` is typed `(value?: string) => void` — a bare `useState<string>` setter won't accept the optional `undefined`. The mapping now instructs the lift to wrap: `onValueChange={(v) => setState(v ?? "")}`.

## [0.16.1] — 2026-05-12

### Changed
- **Copy Lift Manifest** now clipboards a ready-to-paste prompt with the manifest embedded inside — not just the raw XML. Paste it directly into a Claude Code chat and run; no more copy-paste-then-hand-write-the-instructions. The prompt tells the agent how to walk the manifest (conventions first, then inventory, then icons, etc.), where to write the output (`tmp/lift/<frame>.tsx` by default), and what to report when done. Codebase-agnostic — works against any target repo that has the production components the manifest points at.

## [0.16.0] — 2026-05-12

### Changed
- The **Copy Lift Manifest** button now emits a substantially richer manifest. When a beta tester pastes it into Claude Code to translate a Studio frame into a production codebase, the downstream agent has dramatically more context to work with — fewer hallucinations, fewer silent drops, fewer "this is what I guessed, reviewer please confirm" TODOs. Validated against two real frames across three fresh-agent lift runs: the same five-to-six TODOs the agent leaves now represent genuine reviewer decisions rather than gaps the manifest itself introduced.

  Under the hood this was a multi-step refactor of the lift subsystem (eight small PRs documented in `studio/docs/plans/2026-05-11-lift-manifest-rules-over-tables.md` and the follow-up PR-6 revision), shifting from a pure component-mapping table toward a small **conventions** layer plus targeted data edits. The manifest now carries:
  - `<icon_convention>` teaching the agent to grep `ICON_TYPES` for icon matches (absorbs what was previously dozens of unmapped icons — the single biggest win), plus `<chrome_convention>` (drop `NavSidebar` / top-bar at the page boundary — the router owns Nav), `<overlay_convention>` (lift hand-rolled `fixed inset-0` overlays to production `<Modal>` instead of preserving raw divs), and a `<default_mapping_convention>` safety net for anything the table didn't cover.
  - `<prior_art>` anchors pointing at real devrev-web files that demonstrate each structural mapping in use — the agent reads the example before writing code, short-circuiting most shape questions.
  - `<dropped_props>` explicitly listing Studio props with no production equivalent (e.g. `Chip.appearance`), so the downstream stops silently dropping them.
  - `<tokens alignment="patching">` with self-sunsetting patches for arcade-gen tokens and Tailwind utilities that don't resolve in devrev-web yet (`--surface-overlay` → `--bg-surface-overlay`, `rounded-square-x2` → `rounded-lg`, etc.).
  - Splits the `settings-form` shape into `settings-form` (has form inputs) and `settings-list` (has `SettingsPage` but no form inputs) so scaffolding checklists match reality.
  - Fixes several mapping-table bugs surfaced by a new drift-audit script: the previous table claimed production exports for `VistaRow`, `VistaPagination`, `VistaGroupRail`, and `SettingsRow` that don't actually exist in devrev-web (now honestly classified as judgment+n/a with reviewer notes), and `Tabs` was pointing at a `TabList` export that was really named `Tabs` (corrected).

### Added
- `pnpm run studio:audit` runs the new lift-manifest drift audit against a local devrev-web clone (`DEVREV_WEB_ROOT`, defaults to `~/devrev-web`). Verifies every mapping's production specifier resolves, every named export exists, every `<prior_art>` path still lives on disk, every icon anchor is still in `ICON_TYPES`, and every token patch is still needed. Exits non-zero on drift. Skipped by default in the regular test suite so contributors without the clone stay green.

## [0.15.1] — 2026-05-12

### Fixed
- The 0.15.0 design-system sync could block the main chat turn for minutes on large Figma files, showing "Working… 10m" with no narration and no frames. Root cause was twofold: the sync ran *before* the Claude turn (inside `Promise.all`), and the subprocesses it spawned (four `figmanage` reads, up to eight PNG exports, one synthesizer) had no per-call wall clock. The sync now fires concurrently with the Claude turn (DESIGN.md seeds *future* turns, so there's no reason to block on it), a 90-second cap wraps the whole sync, every `figmanage` call self-terminates after 30s, and `get-file` self-terminates after 45s. Beta testers see "Scanning Figma design system…" narrate immediately; slow scans skip with "Design system sync skipped (timed out after 90s)" instead of hanging.

## [0.15.0] — 2026-05-11

### Added
- Figma design-system sync: the first time you reference a new Figma file, Studio now scans the whole file for styles, variables, components, and a handful of representative frames. It synthesizes a natural-language **Identity** paragraph plus six token sections into a `DESIGN.md` at your project root. The project's CLAUDE.md imports it via `@DESIGN.md` so the generator sees cross-frame design-system context on every turn — anchoring visual personality and the full available token vocabulary, not just what's on the current frame. Your `DESIGN.md` is never overwritten; edit it freely.

### Fixed
- Runtime glue for the Figma design-system scan: the claude CLI doesn't support `--attach` for images (fixed to use the Read tool + `--add-dir`); `figmanage reading get-file` times out on large files (fixed with `--depth 2`); prompt was being swallowed by the CLI's variadic `--add-dir` argparser when passed positionally (fixed by piping via stdin).

## [0.14.0] — 2026-05-08

### Added
- Inter-frame navigation via `<FrameLink target="NN-slug">`. When your prompt names an element that should transition between frames — "clicking the skill card opens the modal", "clicking Edit goes to settings" — the agent wraps that element. Clicking it scrolls the viewport to the target frame and highlights it for about a second. Keyboard-accessible (Tab + Enter/Space).
- Agent template teaches this wiring only when prompts explicitly name the trigger. If the prompt is silent about interactions, the agent ships three disconnected frames and flags the missing navigation in its Deviations section.

## [0.13.1] — 2026-05-08

### Fixed
- Long turns that used to cut off with "Turn timed out after 420s — claude stopped responding" now auto-resume from where they paused. Multi-frame generations in particular were hitting the old 7-minute ceiling; the limit is now 15 minutes and the turn is auto-continued on timeout. When the retry budget is fully exhausted, the in-chat message tells the user to type "keep going" to continue — no more log-file references in the banner.
- Fixed a rare case where a killed claude process left its stdio pipes open, stranding the turn indefinitely instead of failing cleanly.

## [0.13.0] — 2026-05-08

### Added
- Agent detects flow-shaped prompts ("4-step onboarding", "wizard", "checkout flow") and proposes splitting them into multiple frames before building. If the user confirms, every frame is generated in a single turn with two-digit filename prefixes.
- "+ New frame" button in the viewport (end of the frame row) and in the empty state. Clicking it creates a blank frame on disk and focuses the chat with "Design the Untitled N screen: " pre-filled.

### Changed
- Frame display names now omit the numeric filename prefix (e.g. "Home" instead of "01 Home"). Frame slugs and on-disk paths are unchanged — this only affects how names render in the frame header, share modal, and seeded chat prompt.

## [0.12.1] — 2026-05-08

### Fixed
- ⌘/ctrl+scroll now zooms the canvas even when the cursor is over a frame (iframes were a hard event boundary and the gesture escaped to the browser's native page zoom). Space-drag and middle-mouse pan also work when starting over a frame.
- Wheel zoom is now continuous and proportional — trackpad pinch feels smooth instead of jumping several discrete steps per event. Keyboard shortcuts and menu items still snap to the discrete ladder (50% / 100% / 200%).
- Canvas background is uniform at any zoom level — the darker inner rectangle that appeared when zooming out is gone.
- Dev-only: stale Vite HMR socket errors no longer red-screen frames after a dev-server restart.

## [0.12.0] — 2026-05-07

### Added
- Viewport zoom and pan: `⌘`/`ctrl`+scroll zooms at the cursor, space-drag or middle-mouse pans. `⌘+=` / `⌘+-` step the zoom, `⌘+0` resets to 100%, `⌘+1` fits to screen (may be intercepted by some browsers — use the zoom pill's "Zoom to fit" menu item as an alternative). Zoom persists per project. A new zoom indicator pill in the bottom-right replaces the old "Preview" label and exposes the same actions via menu.

## [0.11.1] — 2026-05-07

### Fixed
- Generator no longer re-reads the manifest or greps arcade-gen after writing a frame. The deviations contract had been inadvertently encouraging a post-write self-audit loop that burned through the turn budget and caused timeouts; now uncertainty is surfaced in the Deviations section instead of proved via extra tool calls.
- Clarified that uncertainty is NOT a license to skip parts of the design. Every card, rail, and section in the reference still gets built — deviations describe how, not what was dropped.

### Changed
- Deviations bullets now follow a "write for a designer, not an engineer" rule: no raw hex, no Tailwind class fragments, no CSS variable names, no component prop syntax, no internal icon identifiers.
- Deviations section capped at 5 bullets, with explicit merging rules (related color facets, sidebar dimensions, multiple guessed icons) so the list stays scannable.

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
