import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the path (or bare command name) that studio will pass to `spawn()`
 * for the Claude CLI.
 *
 * Resolution order, stopping at the first hit:
 *   1. `ARCADE_STUDIO_CLAUDE_BIN` — explicit override; users with a custom
 *      install layout or those running an unreleased build point at it.
 *   2. `<repoRoot>/node_modules/.bin/claude` — the vendored CLI, if someone
 *      has installed `@anthropic-ai/claude-code` locally.
 *   3. `"claude"` — the bare command; spawn() walks `$PATH`. Covers the
 *      common global-install cases (`~/.local/bin`, Homebrew, `npm i -g`).
 *
 * Callers don't need to worry about the difference between an absolute path
 * and a bare name; Node's spawn accepts both.
 */
export function resolveClaudeBin(): string {
  const override = process.env.ARCADE_STUDIO_CLAUDE_BIN;
  if (override) return override;

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  // This file lives at studio/server/claudeBin.ts. Repo root is two levels up.
  const repoRoot = path.resolve(moduleDir, "..", "..");
  const vendored = path.resolve(repoRoot, "node_modules", ".bin", "claude");
  if (existsSync(vendored)) return vendored;

  return "claude";
}
