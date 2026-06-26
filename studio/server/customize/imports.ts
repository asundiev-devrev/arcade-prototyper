// studio/server/customize/imports.ts
const ARCADE = "@xorkavi/arcade-gen";

/** Ensure every name in `names` is imported from arcade-gen. Minimal string edit. */
export function reconcileArcadeImports(source: string, names: string[]): string {
  if (names.length === 0) return source;
  const importRe = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${ARCADE.replace(/[/-]/g, "\\$&")}["'];?`);
  const m = importRe.exec(source);
  if (m) {
    const existing = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const merged = [...existing];
    for (const n of names) if (!existing.includes(n)) merged.push(n);
    if (merged.length === existing.length) return source; // no-op
    const rebuilt = `import { ${merged.join(", ")} } from "${ARCADE}";`;
    return source.slice(0, m.index) + rebuilt + source.slice(m.index + m[0].length);
  }
  // no existing arcade-gen import → insert at top
  const line = `import { ${names.join(", ")} } from "${ARCADE}";\n`;
  return line + source;
}
