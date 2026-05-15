/**
 * Per-project replay buffer. Holds the tail of recent chat events plus
 * the most recent content for every frame path that has been written.
 *
 * Used on guest connect to bring them up to current state with a single
 * `cache_replay` event, instead of waiting for the next prompt to see
 * any frames at all.
 *
 * Chat is bounded (ring buffer). Frames are bounded by the host's project
 * itself — there are typically a few dozen per project, so a Map is fine.
 */

export interface ReplaySnapshot {
  chatHistoryTail: unknown[];
  frames: Record<string, string>;
}

export interface ReplayBuffer {
  recordChat(event: unknown): void;
  recordFrame(path: string, content: string): void;
  deleteFrame(path: string): void;
  snapshot(): ReplaySnapshot;
  reset(): void;
}

export function createReplayBuffer(opts: { chatTailLimit: number }): ReplayBuffer {
  const limit = opts.chatTailLimit;
  let chat: unknown[] = [];
  const frames = new Map<string, string>();

  return {
    recordChat(event) {
      chat.push(event);
      if (chat.length > limit) chat = chat.slice(chat.length - limit);
    },
    recordFrame(path, content) {
      frames.set(path, content);
    },
    deleteFrame(path) {
      frames.delete(path);
    },
    snapshot() {
      return { chatHistoryTail: [...chat], frames: Object.fromEntries(frames) };
    },
    reset() {
      chat = [];
      frames.clear();
    },
  };
}
