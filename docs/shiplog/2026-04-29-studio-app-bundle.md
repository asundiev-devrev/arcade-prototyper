# Shiplog: Arcade Studio `.app` bundle + figmanage migration

**Shipped:** 2026-04-29
**Merge commit:** `972e1bf`
**Related plan:** [`docs/superpowers/plans/2026-04-29-studio-app-bundle.md`](../superpowers/plans/2026-04-29-studio-app-bundle.md)

## What changed for users

**Designers on DevRev laptops can now install Arcade Studio by downloading a `.dmg` and dragging it to `/Applications`.** No terminal, no `pnpm install`, no cloning a repo, no `figma-cli` clone, no `~/figma-cli` path. Studio opens in their browser on double-click.

Install flow (documented in [`studio/packaging/README.md`](../../studio/packaging/README.md)):

1. Download `Arcade Studio.dmg` from the internal share link.
2. Drag to `/Applications`, eject the DMG.
3. Double-click → macOS Gatekeeper dialog appears ("cannot verify developer") → close it.
4. **System Settings → Privacy & Security → Open Anyway** (Sonoma+ removed the right-click → Open shortcut for unsigned apps; Settings is the only path).
5. Studio launches. Browser opens `http://localhost:5556`.

Every subsequent launch is a normal double-click.

## What changed in the codebase

| Area | Change |
|------|--------|
| `studio/packaging/` | **New.** `build.sh` orchestrates `lib/{download-node,copy-sources,install-deps,codesign}.sh` to produce a double-clickable `.app` (~716 MB) and a `.dmg` (~294 MB). `dmg.sh` wraps the `.app` for distribution. `launcher.sh` runs as `Contents/MacOS/Arcade Studio` and boots Vite from the bundled Node. |
| `studio/server/figmaCli.ts` | **Rewritten.** Now shells out to the `figmanage` CLI (REST-based) instead of `node ~/figma-cli/src/index.js` (CDP-based). Signatures now take `(fileKey, nodeId, ...)` because figmanage is stateless. Old `daemonStatus` / `figmaCliDir` exports removed. |
| `studio/server/middleware/figma.ts` | Reshaped: `GET /api/figma/node/:fileKey/:nodeId` (was `/:nodeId`); same for `/tree`. `POST /api/figma/export` body now requires `fileKey`. New SSE `POST /api/figma/auth/login` spawns `figmanage login`. |
| `studio/server/figmaTabSelector.ts` | **Deleted.** The CDP-tab disambiguator is obsolete — figmanage is stateless and doesn't depend on Figma Desktop at all. |
| `studio/src/components/shell/FigmaConnectButton.tsx` | **New.** First component-level UI test in the codebase. Polls `/api/figma/status`, shows "Connect Figma" when unauthenticated, opens the `figmanage login` OAuth flow via the SSE endpoint. |
| `package.json` (repo root) | Added `pnpm studio:pack` script. |
| `studio/README.md`, `studio/DEVELOPMENT.md` | Updated prerequisite list (no more `~/figma-cli` clone), added "Building a distributable `.app`" section, refreshed troubleshooting. |

## Dev workflow

```bash
# Build and package (takes ~30s warm, ~5min cold)
pnpm studio:pack

# Artifacts land at:
#   studio/packaging/dist/Arcade Studio.app
#   studio/packaging/dist/Arcade Studio.dmg
```

## Why unsigned

DevRev doesn't yet have an Apple Developer ID certificate to sign with. The bundle is ad-hoc signed (satisfies Gatekeeper's "is there a signature" check but not "is the signature trusted"), which is why the first-launch Privacy & Security dance is needed. Eventually a proper cert will eliminate that step — no code changes required, just swap the `codesign --sign -` call for `codesign --sign "Developer ID Application: ..."`.

## What's deferred

Spec'd out but **not** part of this merge (separate plans):

- **SSO keeper** — background `aws sso login` refresh so users don't hit hourly re-auth interruptions mid-session.
- **`curl | sh` installer** — one-liner that bootstraps the dev environment (brew deps, AWS CLI, cloning the repo) for engineers who want the *source*, not just the `.app`.
- **Signed + notarized `.app`** — when DevRev has a Developer ID cert, remove the Privacy & Security step.
- **Intel (x64) / universal binary** — `build.sh` accepts `ARCH=x64` but no multi-arch pipeline yet. Most DevRev laptops are Apple Silicon.

## Related reading

- [Implementation plan (15 tasks, full TDD steps)](../superpowers/plans/2026-04-29-studio-app-bundle.md)
- [Lessons learned: why e2e file-existence tests weren't enough](../lessons-learned/2026-04-29-packaging-test-gaps.md)
- [Install instructions for internal users](../../studio/packaging/README.md)
