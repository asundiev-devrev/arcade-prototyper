// studio/src/lib/pendingPrompt.ts
export interface PendingHeroPrompt {
  prompt: string;
  imagePaths: string[];
  figmaUrl: string | null;
}

const bucket = new Map<string, PendingHeroPrompt>();

export function setPendingPrompt(slug: string, value: PendingHeroPrompt): void {
  bucket.set(slug, value);
}

/** Read-and-remove. Returns undefined if no pending prompt for this slug. */
export function takePendingPrompt(slug: string): PendingHeroPrompt | undefined {
  const value = bucket.get(slug);
  if (value !== undefined) bucket.delete(slug);
  return value;
}

/** Read without removing. Used by ChatPane to paint an optimistic
 *  "Working…" row during the homepage→project handoff, before the route's
 *  useEffect-driven `send()` has flipped the chat-stream state to running. */
export function peekPendingPrompt(slug: string): PendingHeroPrompt | undefined {
  return bucket.get(slug);
}

export function clearPendingPrompt(slug: string): void {
  bucket.delete(slug);
}

export function __resetPendingPromptForTests(): void {
  bucket.clear();
}
