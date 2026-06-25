# Project Cleanup Audit — 2026-06-25

End-to-end read-only audit of `arcade-prototyper` (skill + Studio app). Run across six
dimensions by parallel agents; every finding grep-verified. This doc tracks remediation
progress — tick items as they ship.

**Snapshot at audit time:** app version `0.41.2`, repo `26 GB` on disk, `1548/1549` tests
green, typecheck clean. Code itself is healthy — no dead features, no real TODO debt, no
copy-paste, no critical security holes. The problems are *around* the code: disk bloat,
`.gitignore` gaps, drifted docs, and two dormant build traps.

Status legend: ☐ todo · ◐ in progress · ☑ done · ⊘ won't fix

---

## 🔴 P0 — Reclaim disk (~8.4 GB junk, none tracked)

Root cause: `.gitignore` never covered the scratch/capture/build-output paths, so they
accumulated unbounded.

| ☑ | Path | Size | Action | Notes |
|---|------|------|--------|-------|
| ☑ | `.playwright-mcp/` | 3.3 GB | `rm -rf` | screenshot scratch; one console log was 926 MB + a stale 322 MB old DMG |
| ☑ | `.claude/worktrees/studio-assets-panel` | 2.0 GB | `git worktree remove --force` | orphaned worktree — removed via git, NOT rm |
| ☑ | `studio/packaging/dist/` | 1.9 GB | `rm -rf` | built `.app`, regenerates on `studio:pack` |
| ☑ | `studio/packaging/vsix-stage/` | 1.0 GB | `rm -rf` | VSIX stage, `stage-vsix.mjs` rebuilds each run |
| ☑ | root `*.png` (208 files, top-level only) | ~21 MB | `rm` | loose screenshots, 0 code refs. Tracked PNGs in subdirs (kit thumbs, dmg bg) preserved |
| ☑ | `tmp/`, `studio/tmp/`, `studio/packaging/rsync-test/`, `composite-screenshots/` | ~13 MB | `rm -rf` | scratch |
| ☑ | 9 `.DS_Store` files | trivial | `find -delete` | macOS cruft |

**Result: 26 GB → 1.9 GB (~24 GB reclaimed). Done 2026-06-25. Tracked file count unchanged
(899) — no tracked file touched.**

> ⚠️ **Follow-up found during P2:** the first pass missed the **root `dist/` = 16 GB** —
> electron-builder output holding **40+ old DMGs/zips** accruing since v0.24.0 (~600 MB per
> release, never pruned). Already gitignored (`dist/` line 5), 0 tracked files, regenerates
> on `studio:pack`. Deleted. This was the bulk of the remaining bloat.
> **Add a post-build prune step** (keep only the current version's artifacts) so `dist/`
> doesn't refill on every release.

### Stop the bleed — `.gitignore`
- [x] Add: `.playwright-mcp/`, `.superpowers/`, `.claude/`, `.career-framework-cache.json`,
  `studio/packaging/vsix-stage/`, `studio/packaging/rsync-test/`, `tmp/`,
  `composite-screenshots/`, `/*.png` (anchored — don't ignore legit PNGs in `studio/`),
  `*.log`, `arcade-plan*.json`, `live-slj.json`, `manifest-icons.json`, `vista-13460*`,
  `sync-career-framework.py`, `arcade-computer-*brief.md`, `DESIGN_SYSTEM_REFERENCE.md`.

### Branch cleanup (42 local → ~17)
- [ ] Delete 22 branches merged into `main` (use `git branch -d`, safe by design).
- [ ] Force-delete 3 stale `backup/*` rebase snapshots.
- [ ] `release/0.27.1` — verify tagged/published, then delete (now on 0.41.2).
- [ ] Keep WIP: `feat/design-in-computer-convergence`, `feat/multiplayer-relay-foundations`,
  `feat/studio-assets-panel`.

---

## 🟠 P1 — Dormant build traps (break fresh machine / CI, not this one) — ☑ DONE 2026-06-25

- [x] **`.npmrc` registry auth dead on pnpm 10.** `_authToken=${GITHUB_TOKEN_PACKAGES}`
  no longer expands from a project `.npmrc` (pnpm 10 security policy). **Deeper issue found:**
  the project `.npmrc` was also *gitignored*, so a fresh clone had **no registry mapping at
  all** — couldn't even locate `@xorkavi/arcade-gen` regardless of token.
  **Fixed:** `.npmrc` now holds only the non-secret `@xorkavi:registry=...` mapping (no
  token) and is un-gitignored so it travels with clones. Auth token must live in user-level
  `~/.npmrc` as `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN_PACKAGES}` with
  `GITHUB_TOKEN_PACKAGES` exported (documented inline in `.npmrc`).
  ⚠️ **Action still needed by maintainer:** neither `GITHUB_TOKEN` nor the `gh` CLI token in
  this env has the `read:packages` scope (both 401 against the registry). A token *with*
  `read:packages` must be put in `~/.npmrc` for a clean `pnpm install` to fetch arcade-gen.
- [x] **`pnpm.onlyBuiltDependencies` silently ignored on pnpm 10** (moved to `pnpm-workspace.yaml`).
  **Fixed:** created `pnpm-workspace.yaml` with `onlyBuiltDependencies: [@anthropic-ai/claude-code,
  electron, esbuild, keytar]`; removed the dead `pnpm` field from `package.json`. Verified:
  pnpm now emits **zero warnings** and reads the allow-list.
- [x] **Side effect — keytar:** adding keytar to the allow-list triggered its native build on
  the next install (`prebuild-install ... Done`); `keytar.node` (97 KB) now present.
  **DevRev PAT now uses macOS Keychain instead of plaintext `.secrets.json`.**

---

## 🟡 P2 — Security / privacy (fine for internal beta; gate before external rollout)

Confirmed safe: no committed secrets, no shell injection (argv array, PAT via stdin), no
path traversal (all paths funnel through `paths.ts` regex), Electron hardened
(`nodeIntegration:false`, `contextIsolation:true`), Cloudflare worker auth enforced.

**No-tradeoff hardening — ☑ DONE 2026-06-25:**
- [x] **Sentry scrubber gaps closed.** Extracted a crypto-free `studio/src/lib/telemetry/scrub.ts`
  (`scrubSentryEvent`) now wired into all 3 Sentry `beforeSend` pipelines (server `redact.ts`,
  renderer `renderer.ts`, electron `telemetry.ts` mirrored). Previously only headers + the
  `prompt` extra were scrubbed; now it also scrubs **error message, exception values,
  stack-frame `filename`/`abs_path`, and breadcrumb messages** for `/Users/<name>` home paths,
  AND a new **token-shaped denylist** (Bearer, `gh*_`, `sk-`, AKIA, JWT). New tests added to
  `redact.test.ts` (stack scrub + never-throws); telemetry suite 41/41 green.
- [x] **Plaintext PAT fallback now 0600.** `secrets/keychain.ts` writes the `.secrets.json`
  fallback with `{ mode: 0o600 }` + a follow-up `chmod 0o600` (writeFile mode only applies on
  create; chmod covers a pre-existing looser file). Applied to both the save and delete-rewrite
  paths.

**Product / analytics decisions — left for maintainer (intentional per observability design,
not bugs):**
- [ ] **PII `distinct_id` = raw email** (`telemetry/identity.ts` + `renderer.ts:58-64`). The
  email is *deliberately* bootstrapped as the PostHog distinct_id so people show up labelled by
  email, not an ugly UUID. Hashing would break that on-purpose UX. **Decision:** keep, or accept
  UUID-labelled people in exchange for hashed ids — your call before any external rollout.
- [ ] **Prompt text egress** — full prompt (2000 chars) to PostHog (`middleware/chat.ts:201`).
  Opted-in analytics per design. **Decision:** keep for internal beta; gate behind consent or
  downgrade to `prompt_length` before external audiences.
- [ ] **Telemetry on-by-default when packaged**, no in-app opt-out / first-run notice. **Decision:**
  add `settings.telemetry.enabled` toggle + first-run disclosure before external rollout.
- [ ] **Worker re-validation (defense-in-depth):** `worker/src/index.ts` trusts Studio's
  normalizer for CF API path segments. Re-apply `[a-z0-9-]`/length validation. (Low; not done.)

---

## 🟡 P3 — Doc drift (3 files mislead a fresh agent) — ☑ 3 docs DONE 2026-06-25

STATUS.md, ROADMAP.md, both CLAUDE.md files = current and trustworthy. The three drifted
docs are now fixed:

- [x] **`studio/ARCHITECTURE.md`** (was worst). Replaced both rotting per-file tables (server
  said ~8 files / reality ~28; middleware said 6 / reality ~21) with a **durable subsystem
  index** that names the 6 previously-missing subsystems (`figma/` kit-emit, `figmaBridge/`,
  `devrev/`, `cloudflare/`, `secrets/`, `sidecar/`, write `hooks/`) and points at `apiPlugin`
  in `vite.config.ts` as the authoritative wiring. Fixed the spawn command (`--add-dir
  <projectCwd>`, model resolution), the layering table (arcade-gen is the published
  `@xorkavi/arcade-gen` dep, not in-tree), marked the diagram illustrative, dropped the
  `thumbnails` mkdir from the create-project flow, added missing env vars.
- [x] **`studio/README.md`** — "proof of concept" → **beta**; deleted the fictional
  `playground/` + `src/` sibling layout + its table; corrected the directory tree (added
  `worker/`, `packaging/`; removed reserved `bin/` and `thumbnails/`); reframed "relationship
  to other folders" as the real two-product split.
- [x] **`studio/DEVELOPMENT.md`** — removed `thumbnails/` from the storage diagram + the
  fictional `thumbnails` test from the coverage list (replaced the whole enumerated list with
  a "browse `__tests__/`" pointer + notable suites); fixed the middleware list, the `@source`
  target (`studio/src/styles/tailwind.css`, not `arcade-gen/src`), `--add-dir <projectCwd>`,
  the boundary-rule wording, the port claim; added missing env vars.

**Deferred — have tradeoffs, left as maintainer decisions:**
- [ ] **61 dated plan docs** (`docs/superpowers/plans/` 45, `studio/docs/plans/` 16), never
  marked shipped. Archiving means moving files that `studio/CLAUDE.md` + `CHANGELOG.md` link
  to (link-breakage risk) → low-value/tedious reorg, not done. Cheapest fix is a `Status:`
  header convention going forward.
- [ ] **`CHANGELOG.md` = 101 KB** append-only. **Not a free split:** `/api/changelog` serves
  the full body and the in-app "What's new" link renders all of it — archiving old entries
  shrinks that history view. `whatsNew.ts` itself only extracts one version section, so the
  per-release modal is fine; the full-history view is the constraint. Decide whether losing
  old versions from the in-app history is acceptable before splitting.

---

## 🟢 P4 — Code cleanups (small, low-risk, when convenient)

- [ ] Delete dead telemetry barrel `studio/src/lib/telemetry/index.ts` + its
  `__mocks__/index.ts` (nothing imports the barrel; consumers import submodules directly).
- [ ] Delete stale untracked `electron/*.js` build artifacts (`viteRunner.js`,
  `shared/awsBootstrap.js`, `shared/freePort.js`) — root copies leftover from old layout.
- [ ] **Test flake:** `figmaIngest.test.ts:182` — fixed `setTimeout(20ms)` races under
  full-suite load. Replace with a poll/await of the disk write.
- [ ] **Fragile mocks:** ~25 test files hand-mock `@xorkavi/arcade-gen` partially — a new
  shell import crashes unrelated tests. Consolidate into one auto-stubbing shared mock.
- [ ] **God-files to split when next touched:** `kitEmit.ts` (1306 lines, 6 jobs),
  `chat.ts` (1108 lines, 3 inline generation strategies). `claudeCode.ts` (673) is fine.
- [ ] Memory correction: `react-day-picker` is now *declared* in arcade-gen's package.json —
  the `arcade-gen-undeclared-deps` memory note is stale.
- [ ] **NEW BUG (found during P2 — failing test):** `__tests__/packaging/arcade-gen-deps.test.ts`
  fails — arcade-gen 1.0.0 now bundles & declares `highcharts` + `highcharts-react-official`,
  but they're not installed in this tree, so they don't resolve. A generated frame using a
  chart would white-screen — same class as the react-day-picker regression. **Blocked on the
  `read:packages` token** (can't reinstall arcade-gen's deps without registry access). Fix:
  ensure these resolve (install / hoist) once registry auth is restored.

---

*Audit method: 6 parallel read-only agents (dead-code/deps, tests, security, repo-hygiene,
arch/docs, build/packaging). Findings cross-checked against actual code, not memory.*
