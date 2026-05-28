import { z } from "zod";

/**
 * Wire types for the multiplayer relay.
 *
 * Two categories:
 *   - clientCommand: client → relay. What a Studio instance can request.
 *   - relayEvent: relay → client. What any session participant observes.
 *
 * All messages are validated at the WebSocket boundary with Zod. Invalid
 * messages produce an `error` event but never crash the relay.
 *
 * See docs/superpowers/specs/2026-05-08-studio-multiplayer-design.md §3.
 */

// ── Commands (client → relay) ─────────────────────────────────────────

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    projectShareId: z.string().min(1),
    asRole: z.enum(["host", "guest"]),
  }),
  z.object({ type: z.literal("request_control") }),
  z.object({ type: z.literal("grant_control"), targetDevu: z.string().min(1) }),
  z.object({ type: z.literal("release_control") }),
  z.object({ type: z.literal("claim_control") }),
  z.object({
    type: z.literal("prompt"),
    text: z.string().min(1),
    turnId: z.string().min(1),
  }),
  z.object({
    type: z.literal("frame_write"),
    path: z.string().min(1),
    content: z.string(),
    turnId: z.string().min(1),
  }),
  z.object({ type: z.literal("frame_delete"), path: z.string().min(1) }),
  z.object({ type: z.literal("cancel_turn"), turnId: z.string().min(1) }),
  z.object({
    type: z.literal("cursor"),
    x: z.number(),
    y: z.number(),
    frameId: z.string().optional(),
  }),
  z.object({
    type: z.literal("agent_event"),
    turnId: z.string().min(1),
    event: z.unknown(),
  }),
  z.object({
    type: z.literal("turn_ended"),
    turnId: z.string().min(1),
    ok: z.boolean(),
    error: z.string().optional(),
    cancelled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("comment_posted"),
    id: z.string().min(1),
    text: z.string().min(1),
    mentions: z.array(z.string()).default([]),
  }),
]);
export type ClientCommand = z.infer<typeof clientCommandSchema>;

// ── Events (relay → client) ───────────────────────────────────────────

export const connectionInfoSchema = z.object({
  devu: z.string(),
  displayName: z.string(),
});
export type ConnectionInfo = z.infer<typeof connectionInfoSchema>;

export const relayEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("presence_state"),
    host: connectionInfoSchema.nullable(),
    guests: z.array(connectionInfoSchema),
  }),
  z.object({
    type: z.literal("cache_replay"),
    chatHistoryTail: z.array(z.unknown()),
    frames: z.record(z.string(), z.string()),
  }),
  z.object({
    type: z.literal("user_joined"),
    devu: z.string(),
    displayName: z.string(),
  }),
  z.object({ type: z.literal("user_left"), devu: z.string() }),
  z.object({
    type: z.literal("control_requested"),
    byDevu: z.string(),
    expiresAt: z.number(),
  }),
  z.object({
    type: z.literal("control_changed"),
    driverDevu: z.string().nullable(),
    reason: z.enum(["granted", "claimed", "released"]),
  }),
  z.object({
    type: z.literal("prompt_started"),
    turnId: z.string(),
    byDevu: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("agent_event"),
    turnId: z.string(),
    event: z.unknown(),
  }),
  z.object({
    type: z.literal("frame_written"),
    path: z.string(),
    content: z.string(),
    turnId: z.string(),
  }),
  z.object({ type: z.literal("frame_deleted"), path: z.string() }),
  z.object({
    type: z.literal("turn_ended"),
    turnId: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
    cancelled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("comment_posted"),
    id: z.string(),
    byDevu: z.string(),
    displayName: z.string(),
    text: z.string(),
    mentions: z.array(z.string()),
    ts: z.number(),
  }),
  z.object({
    type: z.literal("cursors"),
    cursors: z.record(
      z.string(),
      z.object({
        x: z.number(),
        y: z.number(),
        frameId: z.string().optional(),
        ts: z.number(),
      }),
    ),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type RelayEvent = z.infer<typeof relayEventSchema>;

// ── Persisted session state ───────────────────────────────────────────

export const sessionInviteSchema = z.object({
  devu: z.string().min(1),
  invitedByDevu: z.string().min(1),
  invitedAt: z.string(),
});
export type SessionInvite = z.infer<typeof sessionInviteSchema>;

export const sessionStateSchema = z.object({
  id: z.string().min(1),
  sessionObject: z.string().min(1),
  hostDevu: z.string().min(1),
  projectSlug: z.string().min(1),
  linkedWorkId: z.string().nullable(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  invites: z.array(sessionInviteSchema),
});
export type SessionState = z.infer<typeof sessionStateSchema>;

export const sessionsFileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(sessionStateSchema),
});
export type SessionsFile = z.infer<typeof sessionsFileSchema>;

// ── Plan 2b: shared-project model ─────────────────────────────────────

export const sharedWithEntrySchema = z.object({
  devu: z.string().min(1),
  displayName: z.string().min(1),
  addedAt: z.string(),
  addedBy: z.string().min(1),
});
export type SharedWithEntry = z.infer<typeof sharedWithEntrySchema>;

export const projectStateSchema = z.object({
  id: z.string().min(1),
  hostDevu: z.string().min(1),
  projectSlug: z.string().min(1),
  createdAt: z.string(),
  shared_with: z.array(sharedWithEntrySchema).default([]),
});
export type ProjectState = z.infer<typeof projectStateSchema>;

export const projectsFileSchema = z.object({
  version: z.literal(2),
  projects: z.array(projectStateSchema),
});
export type ProjectsFile = z.infer<typeof projectsFileSchema>;
