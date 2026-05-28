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

export function clearPendingPrompt(slug: string): void {
  bucket.delete(slug);
}

export function __resetPendingPromptForTests(): void {
  bucket.clear();
}
