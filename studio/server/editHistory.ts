// studio/server/editHistory.ts
const stacks = new Map<string, string[]>();
const key = (slug: string, frameSlug: string) => `${slug}::${frameSlug}`;

export function pushSnapshot(slug: string, frameSlug: string, source: string): void {
  const k = key(slug, frameSlug);
  const s = stacks.get(k) ?? [];
  s.push(source);
  stacks.set(k, s);
}
export function popSnapshot(slug: string, frameSlug: string): string | null {
  const s = stacks.get(key(slug, frameSlug));
  if (!s || s.length === 0) return null;
  return s.pop() ?? null;
}
export function hasSnapshot(slug: string, frameSlug: string): boolean {
  const s = stacks.get(key(slug, frameSlug));
  return !!s && s.length > 0;
}
export function clearHistory(slug: string, frameSlug: string): void {
  stacks.delete(key(slug, frameSlug));
}

/**
 * Pre-turn source cache for render-verify (the "before" render). Distinct from
 * the undo `stacks` above: one slot per slug+frame (overwritten each turn), and
 * it holds MULTIPLE files (every pages/*.tsx of the frame) so whichever page the
 * agent edits has a before-source. NOT a stack — render-verify only needs the
 * immediately-prior source, and only for the current turn.
 */
const preTurnSources = new Map<string, Record<string, string>>();

function preTurnKey(slug: string, frameSlug: string): string {
  return `${slug} ${frameSlug}`;
}

export function cachePreTurnSources(slug: string, frameSlug: string, sources: Record<string, string>): void {
  preTurnSources.set(preTurnKey(slug, frameSlug), { ...sources });
}

export function getPreTurnSource(slug: string, frameSlug: string, relPath: string): string | null {
  const m = preTurnSources.get(preTurnKey(slug, frameSlug));
  return m && Object.prototype.hasOwnProperty.call(m, relPath) ? m[relPath] : null;
}

export function clearPreTurnSources(slug: string, frameSlug: string): void {
  preTurnSources.delete(preTurnKey(slug, frameSlug));
}
