import fs from "node:fs/promises";
import { onAnyProjectEvent } from "./wsServer";
import { getProject } from "./projectRegistry";
import { chatHistoryPath } from "../paths";
import type { ChatMessage } from "../types";
import type { RelayEvent } from "./types";

/**
 * Persist `comment_posted` relay events into the host's local chat history.
 *
 * Without this, comments left in the chat pane by spectators travel through
 * the relay (broadcast to all connected sockets) but the host's own studio
 * never writes them to `<projectsRoot>/<slug>/chat-history.json` — so the
 * host's chat pane shows nothing, and a reload loses the comment entirely.
 *
 * The relay's replay buffer keeps the comment alive for late-joining guests,
 * but the host's chat history is the source of truth for the host's UI; we
 * have to mirror in. Run from boot, after `hydrateProjectRegistry()`.
 *
 * Idempotent on a per-comment-id basis: a `comment:<id>` already in history
 * is left alone (relay rebroadcasts on guest reconnect would otherwise
 * duplicate the bubble).
 *
 * Subscribes to every project's broadcast bus globally, filters by host
 * devu, and looks up the project on each event so projects shared after
 * boot are picked up automatically.
 */
export function attachHostCommentInbox(hostDevu: string): () => void {
  return onAnyProjectEvent((projectShareId, ev) => {
    if (ev.type !== "comment_posted") return;
    const project = getProject(projectShareId);
    if (!project || project.hostDevu !== hostDevu) return;
    void persistComment(project.projectSlug, ev);
  });
}

async function persistComment(
  projectSlug: string,
  ev: Extract<RelayEvent, { type: "comment_posted" }>,
): Promise<void> {
  const file = chatHistoryPath(projectSlug);
  let history: ChatMessage[] = [];
  try {
    history = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    // Missing or unreadable history file — bail rather than clobber. The
    // project may have been deleted while a guest was still connected.
    return;
  }
  const id = `comment:${ev.id}`;
  if (history.some((m) => m.id === id)) return;
  const msg: ChatMessage = {
    id,
    role: "user",
    content: ev.text,
    createdAt: new Date(ev.ts).toISOString(),
  };
  history.push(msg);
  try {
    await fs.writeFile(file, JSON.stringify(history, null, 2));
  } catch (err) {
    console.warn(`[host-comment-inbox] failed to persist comment for ${projectSlug}:`, err);
  }
}
