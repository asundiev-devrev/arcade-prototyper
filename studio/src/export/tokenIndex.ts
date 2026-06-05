// Resolved-value → token-name index. getComputedStyle gives us resolved colors,
// not var() refs, so we reverse-map them against the tokens DevRevThemeProvider
// injected on :root. Collisions are expected (semantic aliases share a value);
// the SLJ carries candidate names and the Figma consumer (#2) disambiguates by
// the property the value is used for.

export type TokenIndex = Map<string, string[]>;

const norm = (v: string): string => v.replace(/\s+/g, "").toLowerCase();

/** Canonicalize a CSS color to `rgba(r, g, b, a)` (r/g/b ints 0-255, a a number,
 *  default 1) so hex (as authored on :root) and the browser-normalized rgba/rgb
 *  forms (from getComputedStyle on an element) compare equal. Non-color values
 *  (e.g. "8px", "Inter") are returned trimmed and unchanged.
 *
 *  Alpha is rounded to 2 decimals to mirror how browsers serialize an 8-bit hex
 *  alpha: e.g. `#…1a` (26/255 ≈ 0.102) is reported by getComputedStyle as
 *  `rgba(…, 0.1)`. Rounding to 2dp lands both forms on the same canonical key. */
export function canonicalizeColor(value: string): string {
  const v = value.trim();
  const fmtAlpha = (a: number): string => String(Number(a.toFixed(2)));

  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    // Expand short forms by doubling each nibble.
    if (h.length === 3 || h.length === 4) {
      h = h.split("").map((c) => c + c).join("");
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a255 = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
    const a = Math.round((a255 / 255) * 1000) / 1000;
    return `rgba(${r}, ${g}, ${b}, ${fmtAlpha(a)})`;
  }

  // rgb(...) / rgba(...)
  const rgb = /^rgba?\(([^)]*)\)$/i.exec(v);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => p.trim());
    if (parts.length === 3 || parts.length === 4) {
      const r = parseInt(parts[0], 10);
      const g = parseInt(parts[1], 10);
      const b = parseInt(parts[2], 10);
      const a = parts.length === 4 ? Number(parts[3]) : 1;
      if (![r, g, b, a].some(Number.isNaN)) {
        return `rgba(${r}, ${g}, ${b}, ${fmtAlpha(a)})`;
      }
    }
  }

  // Not a recognized color — pass through unchanged.
  return v;
}

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
  // Color-canonical fallback: hex tokens (as authored on :root) vs. the
  // browser-normalized rgba/rgb form an element's computed style yields.
  const canonTarget = canonicalizeColor(resolvedValue);
  for (const [key, names] of idx) {
    if (canonicalizeColor(key) === canonTarget && names.length > 0) return names[0];
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
