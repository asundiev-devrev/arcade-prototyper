import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guard: no source file may call the browser's native window.confirm /
 * window.alert / window.prompt. They are NO-OPS inside the Cursor / VS Code
 * extension webview (confirm() silently returns false), which broke project
 * delete + rename. Use the promise-based useDialogs() (Dialogs.tsx) instead.
 *
 * The single allowed file is Dialogs.tsx itself, whose NATIVE_FALLBACK
 * intentionally delegates to the native dialogs for the no-provider (unit
 * test) case.
 */
const SRC = path.resolve(__dirname, "../../src");
const ALLOWED = new Set(["components/feedback/Dialogs.tsx"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// The native dialogs that break in the webview. `window.alert(` / `window.prompt(`
// / `window.confirm(` are always native. Bare `alert(` / `prompt(` are also
// native (nothing legit is named that). Bare `confirm(` is ALLOWED — it's the
// useDialogs() API method (`const { confirm } = useDialogs()`), which is the fix.
const WINDOW_PREFIXED = /\bwindow\.(confirm|alert|prompt)\s*\(/g;
const BARE_ALERT_PROMPT = /(?<![.\w])(alert|prompt)\s*\(/g;

describe("no native browser dialogs in studio/src", () => {
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (ALLOWED.has(rel)) continue;
    it(`${rel} uses no native confirm/alert/prompt`, () => {
      const code = fs.readFileSync(file, "utf-8");
      // Strip line + block comments so doc references don't false-positive.
      const stripped = code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const windowHits = [...stripped.matchAll(WINDOW_PREFIXED)].map((m) => m[0]);
      // The lookbehind already excludes `promptText(` and `setPendingPrompt(`
      // (a word char precedes `prompt`), so any remaining bare alert(/prompt(
      // is a genuine native call.
      const bareHits = [...stripped.matchAll(BARE_ALERT_PROMPT)].map((m) => m[0]);
      expect([...windowHits, ...bareHits]).toEqual([]);
    });
  }
});
