// studio/src/lib/pendingPrompt.ts
//
// Hero→project handoff bucket. The HomePage hero submit:
//   1. POSTs createProject  →  server scaffolds files
//   2. setPendingPrompt(slug, ...)
//   3. navigates to /:slug
//   4. ProjectDetailAuthor's effect calls takePendingPrompt → send()
//
// Earlier this was an in-memory Map. That broke under Vite's
// `full-reload` broadcast: the projectWatchPlugin file watcher fires
// `full-reload` on any .tsx/.ts/.css write under projects/, and
// createProject writes `theme-overrides.css` + `shared/devrev.ts` as
// part of scaffolding. The reload arrived asynchronously after the
// client had already stashed the prompt and navigated, wiping the
// in-memory Map and leaving ProjectDetail with nothing to send().
// Symptom: chat pane idle, no Stop button, "dead window" until the
// next user-driven event finally rendered something.
//
// sessionStorage is the right primitive here: it survives a Vite
// full-reload (the tab lives, only modules re-init), and it's still
// scoped to the tab — no cross-window leakage.
export interface PendingHeroPrompt {
  prompt: string;
  imagePaths: string[];
  figmaUrl: string | null;
}

const KEY_PREFIX = "studio:pendingPrompt:";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function key(slug: string): string {
  return `${KEY_PREFIX}${slug}`;
}

export function setPendingPrompt(slug: string, value: PendingHeroPrompt): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key(slug), JSON.stringify(value));
  } catch {
    /* quota / disabled — caller still navigates, chat pane just won't
       paint optimistic state. Silent is fine. */
  }
}

function read(slug: string): PendingHeroPrompt | undefined {
  const s = storage();
  if (!s) return undefined;
  try {
    const raw = s.getItem(key(slug));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.prompt === "string" &&
      Array.isArray(parsed.imagePaths)
    ) {
      return parsed as PendingHeroPrompt;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Read-and-remove. Returns undefined if no pending prompt for this slug. */
export function takePendingPrompt(slug: string): PendingHeroPrompt | undefined {
  const value = read(slug);
  if (value !== undefined) {
    const s = storage();
    s?.removeItem(key(slug));
  }
  return value;
}

/** Read without removing. Used by ChatPane to paint an optimistic
 *  "Working…" row during the homepage→project handoff, before the route's
 *  useEffect-driven `send()` has flipped the chat-stream state to running. */
export function peekPendingPrompt(slug: string): PendingHeroPrompt | undefined {
  return read(slug);
}

export function clearPendingPrompt(slug: string): void {
  const s = storage();
  s?.removeItem(key(slug));
}

export function __resetPendingPromptForTests(): void {
  const s = storage();
  if (!s) return;
  const drop: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(KEY_PREFIX)) drop.push(k);
  }
  for (const k of drop) s.removeItem(k);
}
