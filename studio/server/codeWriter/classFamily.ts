// Ordered list of (matcher for the TARGET class) → (family regex for removal).
// Specific entries first; the parenthesised token colors must precede the
// text-align / type-style entries because all three start with "text-".
const FAMILIES: Array<{ when: RegExp; family: RegExp }> = [
  { when: /^p[trbl]-/,            family: /^p[trbl]-/ },   // matched per-side below by exact side
  { when: /^m[trbl]-/,            family: /^m[trbl]-/ },
  { when: /^gap-/,                family: /^gap-/ },
  { when: /^rounded(-|$)/,        family: /^rounded(-|$)/ },
  { when: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
    family: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/ },
  { when: /^opacity-/,            family: /^opacity-/ },
  { when: /^italic$|^not-italic$/, family: /^italic$|^not-italic$/ },
  { when: /^text-\((--[a-z0-9-]+)\)$/,    family: /^text-\((--[a-z0-9-]+)\)$/ },
  { when: /^bg-\((--[a-z0-9-]+)\)$/,      family: /^bg-\((--[a-z0-9-]+)\)$/ },
  { when: /^border-\((--[a-z0-9-]+)\)$/,  family: /^border-\((--[a-z0-9-]+)\)$/ },
  { when: /^text-(body|title|caption|heading|display|label)[a-z-]*$/,
    family: /^text-(body|title|caption|heading|display|label)[a-z-]*$/ },
  { when: /^text-(left|center|right|justify)$/, family: /^text-(left|center|right|justify)$/ },
];

// Per-side spacing needs the EXACT side prefix as its family (pt only removes pt-*).
function perSideFamily(targetClass: string): RegExp | null {
  const m = /^([pm][trbl]|gap)-/.exec(targetClass);
  if (!m) return null;
  return new RegExp(`^${m[1]}-`);
}

export function familyRegexFor(targetClass: string): RegExp | null {
  const perSide = perSideFamily(targetClass);
  if (perSide) return perSide;
  for (const { when, family } of FAMILIES) {
    if (when.test(targetClass)) return family;
  }
  return null;
}

export function applyClass(className: string, targetClass: string): string {
  const family = familyRegexFor(targetClass);
  const tokens = className.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => t !== targetClass && !(family && family.test(t)));
  kept.push(targetClass);
  return kept.join(" ");
}

export function hasSpacingShorthand(className: string, targetClass: string): boolean {
  if (!/^[pm][trbl]-/.test(targetClass)) return false;
  const axis = targetClass[0]; // "p" or "m"
  const shorthand = new RegExp(`^${axis}(x|y)?-`);
  return className.split(/\s+/).filter(Boolean).some((t) => shorthand.test(t));
}
