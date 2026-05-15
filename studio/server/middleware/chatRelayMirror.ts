import type { RelayEvent } from "../relay/types";
import { getProjectByHostSlug } from "../relay/projectRegistry";
import { broadcastToProject, getReplayBufferForProject } from "../relay/wsServer";

/**
 * Bridge between the host's chat pipeline and the multiplayer relay.
 *
 * When the host's chat middleware appends an event to its `chat-history.json`
 * and emits an SSE event to the host's own browser, it ALSO calls into here.
 * If the project is currently shared and has live guest connections, we
 * broadcast the event over the relay; we always record it into the project's
 * replay buffer so guests joining later catch up via cache_replay.
 *
 * No-op when the project isn't shared (no entry in the project registry).
 */

export interface ProjectRef {
  hostDevu: string;
  projectSlug: string;
}

export function broadcastChatEvent(ref: ProjectRef, event: RelayEvent): void {
  const project = getProjectByHostSlug(ref.hostDevu, ref.projectSlug);
  if (!project) return;
  broadcastToProject(project.id, event);
}

export function recordChatEventForReplay(ref: ProjectRef, event: RelayEvent): void {
  const project = getProjectByHostSlug(ref.hostDevu, ref.projectSlug);
  if (!project) return;
  const buf = getReplayBufferForProject(project.id);
  if (buf) {
    if (event.type === "frame_written") {
      buf.recordFrame(event.path, event.content);
    } else if (event.type === "frame_deleted") {
      buf.deleteFrame(event.path);
    } else {
      buf.recordChat(event);
    }
  }
  // Also broadcast to live guests.
  broadcastToProject(project.id, event);
}
