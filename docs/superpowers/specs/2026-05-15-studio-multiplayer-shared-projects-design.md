# Studio Multiplayer — Shared Projects (Plan 2b) Design

**Status:** Draft, awaiting review.
**Builds on:** 2026-05-08-studio-multiplayer-design.md (Plan 1 + 2a, shipped as 0.18.6).

## 1. Goal

Move Arcade Studio multiplayer from a session model to a **shared-project** model — closer to how Figma treats multiplayer as a property of a document, not a temporary live event. A host shares a project once; collaborators see it as a project tile on their own homepage. They can join and watch frames stream when the host is live, leave and re-open the same tile later, and post text comments at any time. The host can manage who has access and who is currently watching.

## 2. What changes from 2a

| Concept | 2a (sessions) | 2b (shared projects) |
|---|---|---|
| Unit of sharing | A one-shot session per @-mention | A project, persistently shared with a list of collaborators |
| Lifecycle | Session starts when host @-mentions, ends when host stops | Project is shared until host removes a collaborator. Live-vs-offline is a presence state, not a lifecycle |
| Where it appears for a guest | An invite link in a Computer DM that opens a transient join gate | A project tile on the guest's Studio homepage, identical to their own projects but visually marked as shared |
| What a guest gets when host is offline | "Connected, waiting for host…" then nothing | The cached last-seen state of the project (chat history + last-rendered frames) |
| What an @-mention does inside chat | Triggers an entire share+invite flow | Posts a comment addressed to that person inside an already-shared project; with a confirmation prompt, can also act as a shortcut to grant access |
| Tunnel | One per session, ephemeral | One per project that has live collaborators, started on the first guest connect, stopped when the last guest disconnects |

2a's invite flow does not disappear. The Computer DM still goes out when access is granted; the link still opens the recipient's Studio. The link's payload changes from "join this session" to "this project has been shared with you — add it to your homepage."

## 3. User experience

### 3.1 Host: sharing a project

Two entry points:

1. **Share menu in the project header.** Next to the existing "Share to web" button, a new "Share with teammates" button opens a panel listing current collaborators (avatars + names, with a remove button each), an @-mention popover for adding new ones, and a copy-link affordance for re-sending an invite.
2. **@-mention shortcut in chat.** Typing `@andrey` in the chat input still works for hosts who prefer the shortcut. On send, if Andrey is not yet a collaborator on this project, Studio shows an inline confirmation ("Add Andrey to this project?") with a single button. On confirm, Andrey is added to the allowlist; the message body becomes a comment addressed to Andrey within the now-shared project. If Andrey is already a collaborator, the @-mention is just a comment — no confirmation, no re-invite.

When a person is added (by either path), Studio:

1. Writes the new collaborator into the project's local metadata (`shared_with`).
2. Starts the relay tunnel for this project if it isn't already running (i.e. this is the first collaborator).
3. Sends a Computer DM containing a project-share link (markdown-wrapped, same DM/notification posture as 2a).

### 3.2 Guest: receiving a share

The recipient gets a Computer DM. The link points to the share Worker's `/project/<projectShareId>` endpoint. Clicking it opens the recipient's Studio (or, if Studio isn't installed, the existing install-prompt landing page from 2a, with the extended retry window). On arrival in Studio:

1. The deep link's payload is parsed (project share id + relay URL + display name of the host's project).
2. The project is added to the guest's homepage as a shared-project tile and persisted locally on disk under `~/Library/Application Support/arcade-studio/shared-projects/<id>/`.
3. The guest is taken directly into the project view — same shell as their own projects.

Subsequent visits don't require a fresh invite. The tile is already there. Clicking it opens the same view.

### 3.3 Project view (guest side)

The guest's project view is the same shell as their own projects, with these differences:

- The viewport renders frames streamed from the host's relay (or, if the host is offline, from the local cache). The guest can pan/zoom, click into frames, and switch between frames just like in their own projects. They can NOT trigger frame builds.
- The chat pane shows the host's full chat — host prompts, agent narration, agent output, comments — interleaved chronologically. Comments from the guest and any other connected viewer appear inline.
- The chat input only produces comments. The "build a frame" affordance is hidden. Comments do not invoke Claude. Comments can `@`-mention any other collaborator on the project; the @-popover lists the project's collaborators.
- A presence strip in the project header shows avatars of currently-connected viewers. The host has a distinct marker. Hovering an avatar reveals the name.
- A persistent banner at the top of the view shows "Andrey is offline — viewing cached state" when the host's relay is unreachable. Banner clears when host comes online and the WebSocket reconnects.
- The tile on the homepage is visually marked as shared, with a small status indicator: "live" (host online), "offline" (host's relay unreachable), and a host avatar.

### 3.4 Project view (host side)

Host's project view is unchanged from today, plus:

- A presence strip in the project header showing avatars of currently-connected viewers. Empty when nobody is watching.
- The chat pane now interleaves comments from collaborators alongside the host's own prompts and agent activity. Comments are visually distinct from prompts (different background, "comment" tag, author avatar).
- The Share button shows the count of collaborators ("Shared with 3").

### 3.5 Removing a collaborator

From the Share panel, host clicks the remove button next to a collaborator's row. The collaborator is removed from the project's `shared_with` list. The relay boots their WebSocket if connected. Their tile on their own homepage transitions to "Access removed" (the tile remains until they explicitly delete it). No DM is sent for removal.

### 3.6 Out of scope (deferred to follow-ups)

- **Frame-anchored comments** (Figma-style pins on a specific frame at coordinates). 2b is text-pane comments only.
- **Driver handoff** (collaborators driving Claude turns on the host's machine). 2b is host-only driving.
- **Live cursors in the viewport.** 2b has presence avatars only; cursor rendering is the immediate next milestone.
- **Server-backed always-online persistence.** Project state lives only on the host's disk and the guest's local cache. When the host is offline, the cache is what guests see.
- **Read-only "frame history" scrubbing** — the cache holds the last-seen state per frame, not a per-edit history.

## 4. Data model

### 4.1 On the host

The host's existing project directory (`~/Library/Application Support/arcade-studio/projects/<slug>/`) gains a `multiplayer.json` next to `chat-history.json`:

```json
{
  "version": 1,
  "projectShareId": "<uuid>",
  "shared_with": [
    {
      "devu": "don:identity:dvrv-us-1:devo/0:devu/123",
      "displayName": "Andrey Sundiev",
      "addedAt": "2026-05-15T13:00:00Z",
      "addedBy": "<host-devu>"
    }
  ]
}
```

Absence of `multiplayer.json` (or empty `shared_with`) means the project is private. The first collaborator added causes Studio to write `multiplayer.json` (and generate `projectShareId`) and start the relay tunnel for this project.

### 4.2 On the relay

The existing per-session registry generalizes to per-project. A "project record" in the relay is keyed by `projectShareId` and holds:

- `hostDevu`
- `allowlist: devu[]` (mirrors the host's `shared_with`, refreshed on each host connect)
- Connected WebSockets, indexed by devu
- A bounded ring buffer of recent events for replay-on-reconnect (chat events, frame_written events for the most recent state of each frame path — this is the "live cache feed" guests use to catch up)

Sessions, in the 2a sense, no longer exist as user-facing entities. The relay still has internal "session" records but they are 1:1 with a project's live broadcast. Persistence file (`sessions.json`) is renamed `projects.json` with a one-shot migration.

### 4.3 On the guest

A new directory mirrors the homepage: `~/Library/Application Support/arcade-studio/shared-projects/<projectShareId>/`. Contains:

- `metadata.json` — host devu, host display name, project slug (host-side), relay URL, `addedAt`, `lastSeenAt`.
- `chat-history.json` — append-only mirror of the host's chat events. Written from incoming `chat_event` relay events.
- `frames/<frameId>/index.tsx` — last-seen rendered source for each frame path. Overwritten on each `frame_written` event.
- `comments-pending.json` — local queue of comments composed while the host is offline. Flushed on reconnect; cleared on success.

This directory is what the guest's Studio reads when the host is offline; live, the streamed events are layered on top of (and write into) it.

## 5. Wire protocol changes

The existing `relay/types.ts` schema is largely reused. Concrete changes:

### 5.1 Joining

`clientCommand: "join"` payload changes from `{ sessionId }` to `{ projectShareId, asRole: "host" | "guest" }`. The host announces itself as host on connect; guests as guest. The relay validates `asRole` against the connecting user's devu vs. the project's `hostDevu` and `allowlist`.

### 5.2 New events

- `comment_posted` (client → relay → all): `{ id, byDevu, displayName, text, mentions: devu[], ts }`. Mentions are stored but don't currently trigger any side-effect besides UI highlighting.
- `presence_state` (relay → all): `{ host: ConnectionInfo | null, guests: ConnectionInfo[] }`. Replaces parts of `session_state`. Sent on every join/leave so the presence strip stays in sync.
- `cache_replay` (relay → joining client): a single batched event sent immediately after `presence_state` on join. Carries `{ chatHistoryTail: ChatEvent[], frames: Record<framePath, content> }` so a guest catches up to current state with one round-trip rather than waiting for the next prompt to see anything.

### 5.3 Existing events kept

- `prompt_started`, `agent_event`, `frame_written`, `frame_deleted`, `turn_ended` — all flow from host to guests as before.
- `error` — unchanged.
- `cursors`, `request_control`/`grant_control`/`release_control`/`claim_control` — left in the schema for the live-cursor and driver-handoff follow-ups; not exercised by 2b.

### 5.4 Existing events replaced

- `session_state` is removed in favor of `presence_state` + `cache_replay`. Anything that was reading the old `sessionObject` field reads the project's slug from the host metadata instead.

## 6. Server changes (host's Studio)

### 6.1 New: project sharing middleware

`studio/server/middleware/projectSharing.ts`. Endpoints:

- `POST /api/projects/:slug/share` — body `{ devu, displayName }`. Adds collaborator to `multiplayer.json`, ensures tunnel is running for this project, ensures relay project record exists, posts share DM. Idempotent: re-adding an existing collaborator is a no-op for storage but re-sends the DM.
- `DELETE /api/projects/:slug/share/:devu` — removes collaborator, kicks their WS if connected, leaves tunnel running if other collaborators remain, stops it if not.
- `GET /api/projects/:slug/share` — returns current `shared_with` for the Share panel.
- `GET /api/projects/:slug/share/link` — returns a fresh share-link URL (Worker `/project/<projectShareId>` plus relay URL). Used by the "copy link" affordance and by the share DM.

### 6.2 Modified: chat middleware

The `@`-mention shortcut path in `studio/server/middleware/multiplayerInvite.ts` becomes a thin wrapper over the new `projectSharing` endpoint: it calls `POST /api/projects/:slug/share` for new mentions, then writes the comment as a normal chat-history entry. Unchanged: the inline system-message rendering, the `arcade-studio:refresh-chat-history` event.

### 6.3 Modified: relay

`server/relay/sessionRegistry.ts` becomes `projectRegistry.ts`. Each record carries the allowlist and tunnel handle. Tunnel lifecycle is tied to "any guest currently connected to this project" — first connect spins it up via the existing `tunnel.ts`, last disconnect tears it down with the existing `stopTunnel`.

The relay's WS authentication remains as-is (PAT via header or `?pat=` query), with the additional check that the connecting devu is either the host or in the project's allowlist.

### 6.4 Modified: chat event mirroring

The host's chat middleware (`studio/server/middleware/chat.ts`) gets one new hook: when an event is appended to `chat-history.json` for a project that has a live relay record, the event is also broadcast over the relay to all connected guests as the existing event types (`prompt_started`, `agent_event`, `frame_written`, …). No new code path for "host events" — they already exist in 2a's protocol; we just wire the chat pipeline to feed them.

## 7. Server changes (guest's Studio)

### 7.1 New: shared projects middleware

`studio/server/middleware/sharedProjects.ts`. Endpoints:

- `GET /api/shared-projects` — list of all shared-project tiles for the homepage (reads `~/Library/Application Support/arcade-studio/shared-projects/`).
- `GET /api/shared-projects/:id` — metadata + chat history + cached frame paths for the project view.
- `POST /api/shared-projects/:id/comment` — body `{ text }`. If WS is connected, sends `comment_posted` over the relay. If not, queues in `comments-pending.json` and returns "queued".
- `DELETE /api/shared-projects/:id` — removes the local mirror (used after host revokes access, or user-initiated cleanup).
- `POST /api/shared-projects/import` — body `{ projectShareId, relayUrl, hostDevu, hostDisplayName, projectSlug }`. Called by the deep-link route on first arrival, creates the local mirror, kicks off the WS connection.

### 7.2 New: relay client

A long-lived client process inside the guest's Studio dev server, owning one WebSocket per shared project that the user has open. Reconnect with backoff; flushes `comments-pending.json` on reconnect; mirrors incoming events into the on-disk cache as they arrive.

The client is a server-side construct (in the Vite dev process) rather than a browser-side construct. The browser fetches "current state" through the middleware. This keeps the browser tab from holding the only WebSocket — closing the tab doesn't drop the connection. The browser receives updates from the server via SSE (the existing SSE pattern used by the chat middleware), keyed by `projectShareId`.

### 7.3 Modified: homepage

`GET /api/projects` (the existing endpoint that lists the user's own projects) does not change. The homepage UI calls both `/api/projects` and `/api/shared-projects` and merges results, with shared tiles rendered with the multiplayer marker.

## 8. Client (UI) changes

### 8.1 Homepage

- New tile component for shared projects. Same physical size and layout as a normal tile. Adds: small "shared" indicator (avatar of host + tooltip "Shared by Andrey"), live/offline status dot.
- Tiles route to `/shared/:id` instead of `/p/:slug`.

### 8.2 Project view (shared)

A new top-level route `/shared/:id` that mounts a thin variant of the existing project view. Reuses the existing viewport, frame rendering, and chat pane components. Differences:

- Replaces the chat input with a comment-only input (no frame-build affordance, no figma context controls).
- Replaces the "Build" / "Generate" buttons with a comment "Send" button.
- Adds the presence strip in the header.
- Adds the "host is offline" banner when WS is not connected.
- Removes any UI that mutates the host's project (dispatched against guest input — the comment input is the only allowed mutation).

### 8.3 Project view (host)

- Adds the presence strip when `multiplayer.json` exists for this project.
- Comment events from the relay (mirrored into the host's `chat-history.json`) render alongside the host's own chat — visual styling distinguishes a comment from a prompt.

### 8.4 Share panel

- Triggered from the project header's "Share with teammates" button.
- Lists current collaborators (avatar, name, "remove" button).
- Has an @-mention popover identical to the existing chat one for adding.
- Has a "Copy share link" button.

### 8.5 @-mention confirmation

- When the user types `@<name>` in the chat input where `<name>` is not yet a collaborator, the existing inline-confirmation pattern from 2a is reused, with copy "Add <Name> to this project?" and a single confirm button. On confirm, the share endpoint is called and the message proceeds as a comment.

## 9. Worker changes

The share Worker grows one route in addition to today's `/join/<sessionId>`:

`GET /project/<projectShareId>` — the new project-share landing page. Same retry/install-prompt structure as `/join/`, but the deep link payload encodes a project share rather than a session: `arcade-studio://project/<projectShareId>?relay=<url>&host=<devu>&hostName=<display>&projectSlug=<slug>`. The DM that the host's Studio sends now points at this URL.

The legacy `/join/<sessionId>` route stays in the Worker for one release as a fallback for users still on 0.18.6 invites. It can be removed in the next major.

## 10. macOS deep-link

`packaging/launcher.sh` already forwards `arcade-studio://...` as a `#join=<encoded>` hash. Generalize the hash key:

- `#share=<encoded URL>` — accepted by a generalized deep-link parser. The parser inspects the URL path (`/session/...` or `/project/...`) to decide which flow to invoke.
- The existing `#join=` form remains supported for one release, mapped to the same code path.

The frontend `useDeepLinkRoute` hook is updated to parse both shapes; on `/project/...` it calls `POST /api/shared-projects/import` then routes to `/shared/<id>`; on `/session/...` it falls through to the legacy join gate from 2a.

## 11. Notification posture

Notifications via the Computer DM remain a known limitation inherited from 2a. The Computer DM is sent when a collaborator is added; whether it triggers a desktop ping is outside our control with the PAT-based pipeline. 2b does not block on this. (Out-of-scope follow-up: investigate `auth-tokens.create` with `act_as` or a snap-in service account, both noted in the existing DM API memory.)

## 12. Migration from 2a

Active 0.18.6 sessions on the relay at upgrade time are not preserved. The session-based persistence file (`sessions.json`) is migrated on first launch of the new build to `projects.json` with empty allowlists; existing tiles in 0.18.6 (which were never persisted in the homepage anyway) are simply gone. Active 0.18.6 invite links continue to work for one release because the legacy `/join/<sessionId>` Worker route is preserved.

## 13. Testing strategy

- **Relay protocol unit tests** for the new `presence_state`, `cache_replay`, and `comment_posted` events; for the project allowlist enforcement on join; for the cache-replay buffer's correctness on reconnect.
- **Server middleware tests** for `projectSharing.ts` and `sharedProjects.ts` happy paths plus the offline-comment-queue behavior.
- **End-to-end test** with two locally-running Studio instances pointed at a single relay: host shares a project, guest connects, host emits a frame_written, guest's cache is updated, guest disconnects, host emits another frame_written, guest reconnects and receives both via cache_replay.
- **UI tests** for the share panel (add/remove collaborator), the @-mention confirmation dialog, the offline banner, and the comment-only chat input.
- **Manual smoke test** between two physical Macs over the live Cloudflare tunnel: install on guest's machine cold, open share DM, verify the cold-launch retry window from the 2026-05-14 fix still holds.

## 14. Open questions for review

None on the user's side as of this draft. The following are technical follow-ups that don't block the plan but are worth surfacing during the writing-plans step:

- **Cache-replay buffer size.** A bounded ring buffer is fine for chat events, but `frame_written` payloads can be tens of KB each. The replay strategy is "latest content per frame path" rather than "last N events" — confirm the implementation reflects this.
- **Comments queue durability.** If a guest's Studio crashes with `comments-pending.json` half-written, on next launch we need to be sure we don't lose or duplicate. Atomic write + replay-on-launch is the intended approach.
- **Relay reconnect semantics for the host.** If the host's Studio crashes and restarts while guests are connected, guests should see "host offline" for the dropout window. The relay needs to detect host disconnect (existing) and preserve the project record (new — sessions today are evicted on host drop) so guests can resume when the host returns.
