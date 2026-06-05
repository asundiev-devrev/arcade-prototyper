// Resolved-value → token-name index. getComputedStyle gives us resolved colors,
// not var() refs, so we reverse-map them against the tokens DevRevThemeProvider
// injected on :root. Collisions are expected (semantic aliases share a value);
// the SLJ carries candidate names and the Figma consumer (#2) disambiguates by
// the property the value is used for.

export type TokenIndex = Map<string, string[]>;

const norm = (v: string): string => v.replace(/\s+/g, "").toLowerCase();

/** @param names token custom-property names present on :root (e.g. ["--fg-neutral-prominent"]).
 *  @param read returns the resolved value for a given name (wrap getComputedStyle(:root).getPropertyValue). */
export function buildTokenIndex(names: string[], read: (name: string) => string): TokenIndex {
  const idx: TokenIndex = new Map();
  for (const name of names) {
    const value = read(name).trim();
    if (!value) continue;
    const list = idx.get(value);
    if (list) list.push(name);
    else idx.set(value, [name]);
  }
  return idx;
}

/** Single candidate → its name; multiple → first candidate (deterministic);
 *  none → the raw value unchanged. (Multi-candidate disambiguation is #2's job;
 *  Slice 0 keeps the first so output is stable.) Whitespace-insensitive. */
export function resolveToken(idx: TokenIndex, resolvedValue: string): string {
  // Fast path: exact (trimmed) match against the raw-keyed index.
  const trimmed = resolvedValue.trim();
  const direct = idx.get(trimmed);
  if (direct && direct.length > 0) return direct[0];
  // Whitespace-insensitive fallback: compare normalized forms.
  const target = norm(resolvedValue);
  for (const [key, names] of idx) {
    if (norm(key) === target && names.length > 0) return names[0];
  }
  return resolvedValue;
}

/** Enumerate the token custom-property names on a root element's computed style.
 *  Used at runtime in the browser; not exercised by unit tests. */
export function tokenNamesFromRoot(rootStyle: CSSStyleDeclaration): string[] {
  const names: string[] = [];
  for (let i = 0; i < rootStyle.length; i += 1) {
    const prop = rootStyle.item(i);
    if (prop.startsWith("--fg-") || prop.startsWith("--bg-") || prop.startsWith("--stroke-") ||
        prop.startsWith("--surface-") || prop.startsWith("--corner-")) {
      names.push(prop);
    }
  }
  return names;
}
