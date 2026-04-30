# Lessons learned: packaging tests missed three bugs that only surfaced in a real install

**Context:** the `.app` bundle work (shipped in [`972e1bf`](https://github.com/devrev/arcade-prototyper/commit/972e1bf)) had a full test suite of 164 passing tests, including an end-to-end `build.test.ts` that ran `build.sh` and asserted every artifact existed. It caught nothing — the first user install failed three different ways in sequence before working.

This doc captures what the gap was, why the tests couldn't see it, and the patterns to avoid next time.

## The three bugs

### 1. Launcher piped a shell wrapper through `node`

`launcher.sh` had:
```bash
"$NODE_BIN/node" ./node_modules/.bin/vite --config studio/vite.config.ts
```

But `node_modules/.bin/vite` is a bash wrapper (`#!/bin/sh`), not a JS file. Passing it to `node` meant `node` tried to parse shell syntax as JavaScript and crashed on line 2 with `SyntaxError: missing ) after argument list`.

**Test that existed:** "launcher references `node_modules/.bin`" (string match). Passed because the file DID mention that path.

**Fix:** call `node_modules/vite/bin/vite.js` directly (the real JS entry). Added a regression test that asserts the launcher uses `vite.js` in a non-comment line, not `.bin/vite`.

### 2. Bundled Node version below Vite's minimum

Vite 8 requires Node 20.19+ OR 22.12+. The bundle shipped 22.11.0 — just under the line. Vite printed a warning and *tried* to continue, which meant the test ("node binary exists + `node --version` returns `vX.Y.Z`") passed. The real failure was downstream: rolldown (Vite 8's bundler) loaded a binding that only works on compliant Node, and crashed.

**Test that existed:** "node binary returns a version string matching `/^v\d+\.\d+\.\d+$/`". Passed.

**Fix:** bumped to Node 22.14.0 and tightened the test to assert `>= 20.19 || >= 22.12`. Version regex wasn't enough — the constraint is semantic, not syntactic.

### 3. pnpm silently skipped a platform-specific native binding

`pnpm install --frozen-lockfile` resolved the lockfile, which listed `@rolldown/binding-darwin-arm64` as an optional dep. But pnpm's optional-dep handling has a known bug where architecture-specific bindings get skipped in fresh installs. The lockfile claimed the dep; the `node_modules/` tree didn't actually contain it.

At first launch: `Error: Cannot find module '@rolldown/binding-darwin-arm64'`.

**Test that existed:** none explicitly for native bindings. The install-deps test asserted `node_modules/.bin/{vite,claude,figmanage}` existed — all three did.

**Fix:**
- Pass `--config.supported-architectures.os=darwin --config.supported-architectures.cpu=arm64` to both `pnpm install` and `pnpm add`, which forces pnpm to eagerly resolve architecture-specific optional deps.
- **Build-time paranoia check** in `install-deps.sh`:
  ```bash
  if [ ! -d "node_modules/@rolldown/binding-darwin-arm64" ] && \
     ! find node_modules/.pnpm -maxdepth 2 -type d -name "@rolldown+binding-darwin-arm64*" | grep -q .; then
    echo "ERROR: @rolldown/binding-darwin-arm64 not installed. Vite 8 will crash." >&2
    exit 1
  fi
  ```
  Fail loudly during build rather than ship a `.app` that crashes on first launch.

## Why the tests couldn't see it

All three bugs share a pattern: **the test asserted the existence of a file, but the failure mode was about the file's behavior, not its presence.**

- The launcher *file* existed. It wouldn't *execute* correctly.
- The node *binary* existed and returned a version. The version wasn't *compatible* with the JS it would later load.
- The bin *symlinks* existed. The *transitive native binding* they depended on didn't.

File-existence tests are cheap and catch a specific class of bug (forgetting to install something, wrong path). They're blind to:
- Shell/script/binary type mismatches (this is a JS file, not a shell file)
- Semantic version constraints (this version is too old even though it exists)
- Transitive native dependencies (this package loaded, but its `.node` addon didn't)

## What would have caught them

**A boot test.** One that actually executes the launcher, waits for port 5556 to bind, and asserts Studio responds. Concretely:

```ts
it("the built .app launches and serves Studio on port 5556", async () => {
  const launcher = path.join(app, "Contents/MacOS/Arcade Studio");
  const proc = spawn(launcher, [], { detached: true, stdio: "pipe" });
  try {
    await waitForPort(5556, { timeout: 60_000 });
    const res = await fetch("http://localhost:5556/");
    expect(res.status).toBeLessThan(500);
  } finally {
    process.kill(-proc.pid);
  }
});
```

This would have caught all three bugs at test time instead of user-install time.

**Why it wasn't written first:** I optimized for fast test iteration (file-existence checks are deterministic and sub-second). A boot test takes 30-60s and has real side effects (binds a port, spawns a long-lived child). I skipped it in the plan. That was wrong for this class of test — the whole point of the build is that it produces an artifact that BOOTS. An e2e test of a packaging build should always boot the thing.

## Addendum (2026-04-30): two more bugs, a different pattern

After the three bugs above landed, we shipped the DMG to a real user session and hit **two more production-only failures**:

### 4. pnpm 10 silently blocks postinstall scripts

`@anthropic-ai/claude-code` ships a 500-byte `bin/claude.exe` placeholder that its `install.cjs` postinstall is supposed to copy a 216 MB platform-specific native binary over. pnpm 10 introduced a default-deny on postinstall scripts as a security measure — the warning ("Ignored build scripts: @anthropic-ai/claude-code") got lost in the install output, and the bundle shipped with the 500-byte stub. Every chat turn errored with `Error: claude native binary not installed`.

**What existed:** a test for `node_modules/.bin/claude` existing (it did — as a symlink to the stub).
**What was missing:** a test asserting the real binary is present. A ~200 MB file has a size check that's impossible to fool; a 500-byte stub isn't close. The fix was an `if [ $(stat ...) -lt 1000000 ]; then exit 1; fi` check in `install-deps.sh`.
**What worked around pnpm:** `--config.only-built-dependencies`, `pnpm rebuild`, and `pnpm approve-builds` all got swallowed silently in our context. Direct invocation of `install.cjs` after `pnpm add` was the only reliable lever.

### 5. Claude session dir orphaned on project rename

User renamed a project mid-session (`Untitled Project 2` → `Connector experience`). Studio moved the on-disk project directory. Claude CLI indexes sessions by an encoded form of its spawn cwd at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The rename changed the cwd encoding but left the session dir under the *old* name. The next `--resume <session-id>` turn fired from the new cwd, Claude looked in the new-cwd encoded dir, didn't find the session, and errored with `No conversation found with session ID: …`.

**What existed:** tests that `renameProject` moves the project dir correctly.
**What was missing:** a test for the **cross-subsystem consequence** — renaming moves a directory that another component (Claude CLI) has built an external index on. No test in the suite exercised that boundary because no test created a fake Claude session alongside the rename.

**This was the one no build-time test could have caught.** It's a pure runtime integration bug across Studio ↔ Claude CLI ↔ chat middleware.

## Generalizable patterns

Apply to any future "we produce a binary/bundle/image" work:

1. **If the artifact's value is "it runs," a test must run it.** File existence is a proxy, not a proof.
2. **Prefer semantic assertions over syntactic ones.** Don't check "returns a version string"; check "the version is in the supported range." Don't check "the binary exists"; check "the binary's size matches what a real binary would weigh."
3. **Native dependencies + optional deps + frozen-lockfile is a trap.** Assume pnpm/npm will silently skip arch-specific bindings in a fresh install, and assert their presence before declaring success.
4. **Build-time paranoia is cheap insurance.** An `if [ ! -f "$CRITICAL_FILE" ]; then exit 1; fi` costs a line but prevents shipping a broken bundle.
5. **Verify on a truly-fresh environment at least once per major change.** Your dev machine has every possible dep globally installed; it lies to you about onboarding. A second macOS user account or a colleague's laptop is the ground truth.
6. **User-facing operations that move files on disk often cross subsystem boundaries.** If renaming/moving/deleting a resource, ask *which other components have indexed or cached that resource by its previous identity?* Here: Claude CLI indexes sessions by cwd; macOS keychain scopes credentials by bundle id; browser cookies are scoped per origin. A move that doesn't propagate to those indexes silently breaks resume / auth / session continuity.
7. **Trust but verify pnpm output.** Default-deny on postinstall scripts is the most recent example of a toolchain silently changing behavior and emitting a warning that's easy to overlook. Assert the *effect* of each critical install step (was the binary actually replaced?), not just that install ran.

## What's missing: a cross-subsystem integration test

The build-time paranoia checks don't catch class #5 — they only catch "is the right file in the right place." What this codebase is still missing is an integration test that exercises **user actions that cross subsystem boundaries**. For the Studio/Claude/rename axis, that looks like:

```ts
it("resume still works after renaming a project mid-session", async () => {
  const p = await createProject({ name: "Before" });
  // Simulate a real Claude session file under ~/.claude/projects/<encoded-cwd>/
  writeFakeSession(claudeDirFor(projectDir(p.slug)), "sess-1");
  await renameProject(p.slug, "After");
  // After the rename, Claude should still be able to find sess-1 from the new cwd
  expect(existsSync(claudeDirFor(projectDir("after")) + "/sess-1.jsonl")).toBe(true);
});
```

This test now exists (in `studio/__tests__/server/projects.test.ts` as "moves Claude's session dir alongside the project rename"). It'd have prevented #5 the first time. Apply the pattern wherever Studio operates on a resource that other components have external references to.

## Related files

- `studio/__tests__/packaging/build.test.ts` — the existing file-existence test that missed the bugs.
- `studio/__tests__/packaging/launcher.test.ts` — adds the "uses vite.js not .bin/vite" regression guard (#1).
- `studio/__tests__/packaging/download-node.test.ts` — adds the semver-range assertion (#2).
- `studio/packaging/lib/install-deps.sh` — has the build-time paranoia checks (#3, #4).
- `studio/__tests__/server/projects.test.ts` — adds the rename-preserves-session-resume test (#5).
- `studio/server/projects.ts::renameProject` — the rename fix itself (moves the Claude session dir alongside the project dir).
- [Shiplog for this work](../shiplog/2026-04-29-studio-app-bundle.md)
