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
