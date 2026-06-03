/**
 * Compact a frame's raw TSX into a small structural summary for the Computer
 * agent. We send this instead of the full source because DevRev's
 * `ai-agents.events.execute-sync` origin 406s on heavy/slow runs — an 18KB
 * raw-TSX payload pushed agent/620 into a ~21s run that the origin then
 * rejected with an empty-body 406. A structural digest (imported composites +
 * visible text) is a fraction of the size and keeps the agent fast.
 *
 * Pure + regex-based on purpose: no TSX parser, no IO. Robust to junk input
 * (returns a best-effort summary, never throws).
 */

/** Hard cap per-frame summary so a pathological frame can't blow the budget. */
const PER_FRAME_SUMMARY_CAP = 2_000;

export function summarizeFrameSource(frameName: string, src: string): string {
  const components = extractImportedComponents(src);
  const texts = extractVisibleText(src);

  const lines: string[] = [`### frame: ${frameName}`];
  if (components.length > 0) {
    lines.push(`components used: ${components.join(", ")}`);
  }
  if (texts.length > 0) {
    lines.push(`visible text: ${texts.map((t) => `"${t}"`).join(", ")}`);
  }
  if (components.length === 0 && texts.length === 0) {
    lines.push("(no recognizable components or text)");
  }

  const out = lines.join("\n");
  return out.length > PER_FRAME_SUMMARY_CAP
    ? out.slice(0, PER_FRAME_SUMMARY_CAP - 3) + "..."
    : out;
}

/**
 * Pull component/composite identifiers out of `import { A, B } from "..."`
 * blocks. Skips the `import * as React` default and dedups. This is the
 * structural vocabulary the agent needs ("ComputerSidebar", "ChatBubble")
 * without any className/style/JSX soup.
 */
function extractImportedComponents(src: string): string[] {
  const seen = new Set<string>();
  // Match named-import braces across newlines: import { ... } from "...";
  const importRe = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src)) !== null) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      // Components/composites are PascalCase; skip lowercase hook/util imports.
      if (name && /^[A-Z]/.test(name)) seen.add(name);
    }
  }
  return [...seen];
}

/**
 * Extract human-visible strings: JSX text nodes (`>How can I help?<`) and
 * common text-bearing props (title/label/placeholder/aria-label). Filters out
 * code-looking noise (var-like tokens, css values, urls) so the agent sees
 * copy, not implementation.
 */
function extractVisibleText(src: string): string[] {
  const seen = new Set<string>();

  // JSX text between tags: >text<
  const jsxTextRe = />([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = jsxTextRe.exec(src)) !== null) {
    pushIfCopy(seen, m[1]);
  }

  // Text-bearing props: title="..." label="..." placeholder="..." aria-label="..."
  const propRe = /(?:title|label|placeholder|aria-label|heading|subtitle)\s*=\s*["']([^"']+)["']/g;
  while ((m = propRe.exec(src)) !== null) {
    pushIfCopy(seen, m[1]);
  }

  return [...seen];
}

function pushIfCopy(seen: Set<string>, raw: string): void {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return;
  if (t.length < 2 || t.length > 120) return;
  // Drop code-looking tokens: no spaces AND (has a dot/paren/colon, or is a
  // single camelCase/var identifier). Real copy usually has a space or is a
  // capitalized word.
  const looksLikeCode =
    /[(){}:;=]/.test(t) ||
    /^[a-z][a-zA-Z0-9]*$/.test(t) || // single lowerCamel token (var/className fragment)
    /^var\(/.test(t) ||
    /^https?:\/\//.test(t) ||
    /^[\d.]+(px|rem|em|%)$/.test(t);
  if (looksLikeCode) return;
  seen.add(t);
}
