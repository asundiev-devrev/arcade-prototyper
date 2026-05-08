# Studio multiplayer — real-time co-driven prototype sessions

**Status:** design
**Date:** 2026-05-08
**Scope:** `studio/`, plus a small DevRev integration surface (no new DevRev platform dependency for v1)

## The problem

Studio today is single-player. A designer opens the app, types a prompt, Claude generates frames into their local project directory. The experience mirrors what DevRev's Computer agent does in the DevRev workspace — except Computer is also a *communication* tool: it's scoped to conversations that teammates can join.

The ask is to bring that communication aspect into Studio, so a designer can invite other DevRev users to co-drive a prototype in real time — Figma-Make-style multiplayer.

This is a meaningful shape change for Studio. Today it has no server-side presence; multiplayer forces one to exist somewhere. The design below threads the needle: real-time co-driving, invite by DevRev user, conversation backed by Computer, **zero new DevRev platform dependencies and zero mandatory infrastructure cost for v1**.

## Empirical foundation (Spike 1 results)

Before the design was written, we verified Computer's behavior when two different DevRev users share a `session_object` (the client-controlled thread ID Studio already uses). Three tests, three findings:

1. **Thread continuity across PATs: ✅.** PAT-A writes "remember `banana-14`"; PAT-B on the same `session_object` asks what was remembered, gets back `"banana-14"`. Computer threads are keyed by `session_object` alone, not by `(user, session_object)`. This means Computer can be a genuine shared conversation substrate for multiplayer.
2. **Concurrent turns: writable but lossy.** Both PATs hitting the same session simultaneously → both succeed (200 OK), but only one of the two facts survives in the thread's memory. Consequence: the relay must **serialize** prompts per session. A driver-lock is not only a UX nicety — it's a correctness requirement.
3. **Attribution: none from Computer.** The SSE stream is anonymous with respect to who sent the prompt. Studio must carry attribution itself (the relay tags each prompt with the driver's `devu/` id before fan-out).

The spike script is at `/tmp/computer-spike.py` if anyone wants to re-run it.

## Out of scope for v1

- **Cloud-hosted Claude.** Frames are still generated on the driver's local machine. Revisit if DevRev ships a server-side Claude runner.
- **Cursors inside the iframes of generated apps.** Presence stops at the viewport-grid level (see Section 2). Chasing cursors into user-generated React renders is a rabbit hole of cross-origin and DOM-sync that doesn't belong in v1.
- **Real-time co-editing of prompts.** The driver owns the chat input; nobody types alongside them. Operational-transform on the input box is explicitly deferred.
- **Session forking.** "Take this session's frames as the starting point for my solo project" is useful, but a v2 story.
- **Voice / video.** Slack Huddles exists.
- **Session recording / playback.** The relay's event log is ephemeral (bounded ring buffer). Post-hoc review goes through the linked DevRev work item, not a Studio timeline viewer.
- **Non-DevRev-authenticated viewers.** v1 requires a DevRev PAT on both sides. External sharing to customers stays with the existing Vercel (soon Cloudflare) share flow.

## Design

### Section 1 — Architecture

Three moving parts, deliberately bounded:

**The Studio client (unchanged shape, new "Session" concept).** A session has a host, 0–N guests, a current driver, and a backing project. Adding multiplayer does not regress solo usage — "Solo" is the default state and involves no session, no relay, no tunneling.

**The relay (new, in-process on the host's Studio).** A small piece of middleware under `server/middleware/` — the same pattern as `devrev.ts`, `chat.ts`, etc. It is a pub/sub hub keyed by session ID. It does NOT call Claude. It does NOT call Computer. It does NOT store frames. Its three jobs are: maintain the WebSocket fan-out, arbitrate the driver lock, hold a short reconnect replay buffer.

**Generation (on the driver's machine, unchanged).** When anyone who holds the driver lock prompts, their Studio calls Computer with the **shared `session_object`** (Spike 1 proved this is safe), runs the resulting Claude Code turn locally, and forwards every agent event + every frame file write back through the relay so the other participants see the same stream.

**Why this shape:**
- The relay is tiny and its scope is small enough that if we ever need to move it out-of-process (e.g., to DevRev-hosted in a later phase), it's a config change, not a rewrite.
- Computer does what it's already good at (threaded conversation). It's not repurposed as a live transport, because it isn't one.
- Claude frame generation stays where it is — on the driver's disk — so there's no shared-storage / cloud-compute line item.
- When nobody is actively prompting, the relay idles. Zero ongoing AI cost at rest.

### Section 2 — Session lifecycle & driver-lock UX

**States.** Four, one terminal:

- **Solo** — no session, no relay. Studio as it exists today.
- **Live** — session exists, host connected, 0+ guests joined, a driver holds the lock.
- **Dormant** — session exists but nobody is connected. Entered after the driver disconnects and no guest takes over within 60 seconds.
- **Ended** — explicit, one-way. Host clicks "End session"; relay drops all state; guests get a terminal toast.

Three reachable + one terminal. No "paused" vs "dormant" hairsplitting.

**Driver-lock rules.**

1. **Host starts as driver** when they click "Start multiplayer" on an existing project.
2. **Driver identity is a DevRev `devu/` id**, not a device. Closing Studio and reopening keeps the lock.
3. **Taking the pen is a request, not a grab.** Guest clicks "Request control" → current driver sees "<name> wants to drive" with Accept / Ignore. Default timeout: 30 s of driver inactivity = request expires silently. This protects the driver from losing the pen when they step away briefly.
4. **Dormant takeover exception.** If the driver has been offline > 60 s, any invitee may claim the pen without asking. Escape hatch for a dropped host.
5. **Prompt-level enforcement at the relay.** UI disables the chat input for non-drivers, but the relay also short-circuits `prompt` commands that don't come from the current driver. This is the correctness half of Spike 1's finding about concurrent turns.

**What each role sees.**

- **Driver:** full Studio UI; a small "Live — N others watching" pill in the header; other users' messages appear in the chat pane with their avatar/name; cursors of guests visible in the viewport (see below).
- **Guest (not driving):** chat input replaced by a "Request control" button; chat pane read-only; viewport fully interactive (can pan, zoom, click through frames) — watching shouldn't be passive; cursors of other participants visible.
- **Everyone:** live "Thinking…" state during a turn; streaming agent progress (`tool_call`, narration); new frames appearing in the viewport as file-write events arrive.

**Presence (cursors) — in v1.**
- Each connected user broadcasts cursor position in the *viewport-grid* coordinate space: `{ x, y, frameId? }` where `frameId` is populated when hovering over a specific frame card.
- Rate-limited to ≤ 20 Hz on the client, coalesced at the relay.
- Rendered as a colored cursor with a name tag. Color is deterministic from a hash of `devu_id`, so the same person is always the same color across sessions.
- Coordinates are **world-space** (pre-zoom), so when a guest has panned elsewhere the cursor correctly drifts off-screen rather than sitting ghosted at the edge.
- **Cursors stop at the grid.** Inside the iframe of a generated frame, no presence is mirrored.

**Failure modes — explicit handling.**

- **Guest disconnects:** session continues; guest sees "Reconnecting…"; on reconnect, replays the last N events from the relay ring buffer.
- **Driver disconnects:** session enters "driver offline, waiting" state for 60 s; guests see a banner. After 60 s, state → Dormant, each guest sees a "Driver dropped. Take over?" button. First click wins. If the original driver returns post-handoff, they see a "<name> took the pen while you were gone" toast and the Request-control button.
- **Claude subprocess crashes on driver's machine:** error event is fanned out to all participants (same turn-ended payload as a normal error), so guests don't see a silent hang.
- **Driver's Bedrock credentials expire:** existing `AuthExpiredNotice` banner appears for the driver; a terse "Driver is re-authenticating…" banner appears for guests.

### Section 3 — Relay protocol & data model

**Auth on WebSocket connect.** Client sends its DevRev PAT; relay calls `dev-users.self` to resolve the `devu/` id; caches it for the connection lifetime. Invalid PAT → connection closed.

**Commands (client → relay).**

```
{ type: "join",             sessionId }
{ type: "request_control" }
{ type: "grant_control",    targetDevu }                # driver only
{ type: "release_control" }
{ type: "claim_control" }                               # dormant-takeover path only
{ type: "prompt",           text, turnId }              # driver only
{ type: "frame_write",      path, content, turnId }     # driver only
{ type: "frame_delete",     path }                      # driver only
{ type: "cancel_turn",      turnId }                    # driver only
{ type: "cursor",           x, y, frameId? }            # rate-limited to 20 Hz
```

**Events (relay → clients).**

```
{ type: "session_state",    driverDevu, connections, sessionObject }   # on join + on every change
{ type: "user_joined",      devu, displayName }
{ type: "user_left",        devu }
{ type: "control_requested", byDevu, expiresAt }
{ type: "control_changed",  driverDevu, reason: "granted"|"claimed"|"released" }
{ type: "prompt_started",   turnId, byDevu, text }
{ type: "agent_event",      turnId, event }                            # mirror of one Computer SSE event
{ type: "frame_written",    path, content, turnId }
{ type: "frame_deleted",    path }
{ type: "turn_ended",       turnId, ok, error? }
{ type: "cursors",          cursors: { [devu]: { x, y, frameId?, ts } } }  # periodic snapshot, not per-move
{ type: "error",            code, message }
```

**Why some specific shapes:**

- **`turnId` threads a whole generation** (prompt → agent events → frame writes → end). Guests reconnecting mid-turn can say "turn X is in flight, here are its partial results".
- **Frame writes are individual events, not a diff stream.** At Studio's scale (dozens of frames, rarely updated in parallel) simpler wins. If Spike 2 reveals payload-size problems, we chunk individual frames — no CRDT is needed. Frame renames are modeled as `frame_delete(old)` + `frame_write(new)` — no dedicated rename event.
- **Cursor broadcasts are snapshots, not per-move events.** The relay keeps the latest cursor per user in memory and emits the whole map every ~50 ms. O(N) bandwidth instead of O(N²), and reconnects get the current picture in one message.
- **The driver's client does both the real work *and* the reporting.** Computer is called from the driver's Studio; agent events are forwarded through the relay. The relay never holds a DevRev PAT and never contacts Computer directly. Compromising the relay cannot leak credentials.

**The driver's prompt path, end to end.**

1. Driver types in chat, hits Enter. Client generates `turnId = uuid()`, sends `{type:"prompt", text, turnId}` to the relay.
2. Relay validates: connection = current driver? No turn already in flight? If either check fails, reply with `{type:"error", code:"not_driver"|"turn_in_flight"}`.
3. Relay emits `{type:"prompt_started", turnId, byDevu, text}` to *all* connections including the driver's. The driver's UI renders their own prompt from the fan-out, not from local state — this guarantees everyone sees the same chat history.
4. Driver's client (specifically: the existing `server/middleware/chat.ts` codepath) calls Computer with `session_object` from session state and streams SSE.
5. As Computer emits progress/message events, the driver's client forwards each one to the relay as `{type:"agent_event", turnId, event}`. Relay fans out.
6. If Claude writes a frame file to disk, a file watcher in the driver's Studio detects it and emits `{type:"frame_write", path, content, turnId}`. Relay fans out. Guests' Studios receive the event and write the file to their local `projects/<slug>/frames/` directory. Local Vite hot-reloads.
7. Turn ends. Driver's client emits `{type:"turn_ended", turnId, ok, error?}`. Relay fans out. Chat UI exits "Thinking…".

**Data model — what we persist.**

Relay-side (SQLite file on the host's disk, inside Studio's existing app-support directory):

```
sessions (
  id                  text primary key,   -- uuid
  session_object      text unique,        -- passed to Computer; "relay-<uuid>" prefix
  host_devu           text not null,
  linked_work_id      text,               -- optional; e.g. "ISS-1234"
  project_slug        text not null,      -- project on the HOST
  created_at          timestamp,
  ended_at            timestamp
)

session_invites (
  session_id          text not null,
  devu                text not null,
  invited_by_devu     text not null,
  invited_at          timestamp,
  primary key (session_id, devu)
)
```

Durability: session metadata survives Studio restart on the host's machine. Live state (connections, current driver, event log, cursor map) is memory-only — on relay restart, sessions go dormant and everyone reconnects.

Per-client (Studio's `projects/<slug>/meta.json`):

```ts
{
  // existing fields ...
  multiplayer?: {
    sessionId: string;
    sessionObject: string;
    role: "host" | "guest";
    linkedWorkId?: string;
    mirroredFrom?: string;    // host's project slug; only present on guests
  }
}
```

**DevRev linkage — loose coupling, not 1:1.**

The session itself is a relay-owned row, not a DevRev object. On session creation, the host can optionally link the session to a DevRev work item. Default for v1: **a new issue of subtype `design_system_work`** (an existing subtype) with a body that includes `Studio session: <sessionId>` and a link to the tunnel URL. A dedicated `Prototype Session` subtype is a nice-to-have polish item that does not block v1.

Timeline entries get written at four moments: session started, user joined, session ended, share-to-prototype created (when the driver publishes the current state as a static Cloudflare-hosted prototype). These writes are asynchronous and non-blocking — if DevRev's API is slow, the live session doesn't stall.

**Why loose coupling:** tying relay state 1:1 to a DevRev issue would mean every state change becomes a DevRev API round-trip. The issue is the durable artifact people can find later; the relay row is the authority for live state. A foreign key between them is enough.

### Section 4 — Relay hosting & tunneling (cost audit)

The relay runs **in-process in the host's Studio Vite dev server**. It is middleware, not a separate service. This has the property that the relay lives and dies with the host's Studio instance — which exactly matches the "host owns the session" mental model.

For guests to reach the host over the internet, the host's Studio needs a public URL. v1 uses **Cloudflare Tunnel (`cloudflared`)** — free, no account required, bundled into the DMG (~25 MB additional). On session creation, Studio spawns `cloudflared tunnel --url http://localhost:5556` and parses the ephemeral `*.trycloudflare.com` URL from stdout.

**Session directory** (how guests turn a `sessionId` into the host's tunnel URL): v1 stores the tunnel URL in the linked DevRev work item's description (or a custom field). Guests read it via the existing `/api/devrev/works.get` proxy. When Studio migrates prototype deployment from Vercel to Cloudflare (already on the roadmap), this directory role can optionally move to the Cloudflare-hosted surface — a config change, not a new system.

**Cost and dependency audit for v1.**

| Concern | v1 answer | Cost |
|---|---|---|
| Relay compute | In-process on host's machine | $0 |
| Tunneling | Cloudflare Tunnel, account-less | $0 |
| Session directory | DevRev work item (existing APIs) | $0 |
| DevRev subtype | Reuse `design_system_work`; dedicated subtype is polish | $0 |
| Persistence | SQLite on host's disk | $0 |
| DevRev API usage | All existing surfaces (`dev-users.*`, `ai-agents.events.execute-sync`, `works.*`, `add_timeline_entry`) | $0 |

**Zero hard dependencies, zero required cost.** Post-beta scaling paths (e.g., if free-tier Cloudflare Tunnel reliability becomes a problem) are migration stories, not v1 costs.

### Section 5 — Known risks (flagged for implementation, not design)

1. **Frame-streaming latency (Spike 2, deferred).** We haven't proven that streaming `.tsx` content over Cloudflare Tunnel → WebSocket → host's local Vite feels responsive in practice. Needs a standalone two-machine test during implementation. Mitigation if laggy: delta streaming, per-file gzip, or coalescing rapid writes.
2. **Computer progress-event volume.** Spike 1 used trivial prompts that returned a single `message` event. Real prototyping prompts fan out `skill_triggered`/`skill_executed` events. The relay forwards them blindly; if a single turn emits >500 events, coalesce at the driver's client before forwarding.
3. **Bedrock credentials are per-driver.** If a guest takes over and their AWS credentials aren't configured, their turn fails. The error message must be clear ("Your AWS Bedrock credentials are missing — re-auth in Settings") rather than a generic stream error.
4. **Session-object collision.** `session_object` is client-generated. We prefix all multiplayer sessions with `relay-<uuid>-` to eliminate collisions with solo Studio sessions or cross-org accidents.
5. **Corporate firewalls and `cloudflared`.** Some users may not be able to host from restrictive networks. v1 fallback: surface a clear "Tunnel failed to open" error with a link to a troubleshooting note. Migration path if this becomes common: DevRev-hosted tunneling endpoint (platform ask, not v1).
6. **PAT exposure over the tunnel.** Guests connect to the host's Studio over `https://<tunnel>.trycloudflare.com` and authenticate by sending their DevRev PAT. Cloudflare Tunnel is TLS-terminated end-to-end and `trycloudflare.com` URLs are unguessable, but the host's Studio process does briefly see the guest's PAT during `dev-users.self` validation. Guest PATs are held only in the relay connection's in-memory auth cache, never written to disk. If this trust model feels too loose, a follow-up can swap PAT-on-connect for a short-lived HMAC signed by the host at invite time — deferred until we validate the feature is worth more auth plumbing.

## Explicit non-asks of DevRev platform for v1

- No new API surface.
- No new subtype required (reuse `design_system_work`).
- No hosted service required (no relay, no tunnel, no directory).

The feature ships end-to-end using existing DevRev APIs and free third-party infrastructure.

## Success criteria

- Two DevRev users on separate machines can co-drive a prototype session: both see the same chat history, the same agent progress, the same frames appearing in the viewport.
- Only the current driver can prompt. Concurrent prompt attempts from guests are cleanly rejected, not silently swallowed or misattributed.
- Losing a guest's connection does not interrupt the session. Losing the driver's connection triggers a clean handoff path, not a hang.
- A full session (5+ turns, 3 participants, driver handoff once) can complete without the user needing to manually edit files, clear caches, or restart Studio.
- Starting a multiplayer session has no effect on users who never use it. Solo Studio is byte-identical in behavior.

## Out-of-scope explicitly revisited (so future reviewers don't have to reverse-engineer intent)

- **DevRev-hosted relay:** migration path, not v1. The client is written so relay hostname is configurable.
- **A "Prototype Session" issue subtype:** ship polish. Reuse an existing subtype for v1.
- **Cursors inside generated iframes:** v2.
- **Session forking, recording, playback:** v2.
- **Multi-driver concurrent prompting:** incompatible with Spike 1's finding about concurrent turn memory loss. Would require a Computer-side change DevRev platform hasn't committed to.
