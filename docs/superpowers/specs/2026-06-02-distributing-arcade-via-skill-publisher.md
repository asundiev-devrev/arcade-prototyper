# Distributing Arcade in Computer via skill-publisher — design notes

> **Status:** exploration / decision-forcing doc. Not a build plan. Written for the
> Computer eng team + whoever owns the Computer desktop runtime. Companion to
> `docs/superpowers/plans/2026-05-30-computer-arcade-integration.md` (the
> already-built sidecar + instruction-block integration) and
> `studio/docs/computer-sidecar-decision.md` (the open "where does the sidecar
> run" question this doc forces).

## The idea (in one line)

A Computer user prompts *"find the arcade prototyper"* → the agent discovers a
published article, installs the skill it links → from then on the user can
generate full-fidelity arcade prototypes in Computer, no manual setup. Same flow
Andrey used to install `make-page-interactive`.

This is attractive because it makes the arcade workflow **self-distributing**:
no DMG, no installer, no per-tester hand-holding — the same publish/discover/
install/auto-update loop Ribhu's `internal-skill-publisher` already runs for his
skill suite.

## The thing this doc settles

**A skill cannot ship Arcade Studio. It can only bootstrap it.** Understanding why
is the whole point — it tells us what's free and what still needs a decision.

There are *two different things* people call "Arcade Studio," and they distribute
very differently:

| | What it is | Skill-shippable? |
|---|---|---|
| **The Arcade skill** (repo root: `SKILL.md` + `DESIGN.md`) | Pure instructions — turns a Claude session into a one-off HTML prototyper. No runtime. | **Yes, directly.** It already *is* a skill. Publish it as-is. |
| **The Studio app / sidecar** | A running HTTP service that compiles React + Tailwind v4 against the arcade component kit. Needs Node, esbuild, the kit on disk, font fetching. | **No, not as cargo.** A skill folder carries instructions + small scripts, not a working Node build toolchain. |

So the honest framing: skill-publisher can distribute the **know-how and the
bootstrap**, never the **compiler itself**.

## What `pat-manager` proves — and what it doesn't

Last analysis assumed "a skill can't run a server." `pat-manager` disproves the
blanket claim: it's a skill that boots a localhost server (`pat_entry_server.py`
→ `localhost:19847`) with a web dashboard. So "skill starts a local service" is a
real, in-production pattern here.

**But read the fine print before treating it as precedent for the sidecar:**

- **Pure Python stdlib, zero dependencies.** `http.server`, `json`, `threading`.
  A skill folder can carry that and it runs on any machine with Python.
- **Short-lived + transient.** Auto-shuts after ~120s idle / window-close. It's a
  *task* server (collect a token, die), not a *standing* service.
- **No build step, no heavy runtime.** Nothing to compile, nothing to install.

The arcade sidecar is the opposite on all three: **Node + esbuild + Tailwind v4
oxide + the arcade kit**, and it must **stay up** for the whole prototyping
session. `pat-manager` shows the *pattern* (skill launches a process) is
accepted; it does **not** show that a heavy, dependency-laden, long-running
compiler can be carried inside a zipped skill. It can't.

## Therefore: the skill bootstraps, it doesn't contain

The realistic shape — the skill's article/instructions teach Computer to *stand
up* a sidecar, then teach the arcade workflow (which is the instruction block
already built in the integration plan). Two bootstrap options, and **this is the
decision to force**:

### Option A — skill bootstraps a local sidecar per user
The skill's install instructions: clone the arcade-prototyper sidecar, `pnpm
install`, `pnpm run sidecar` (the `pat-manager` "launch a local process"
pattern, scaled up).

- **Pro:** self-contained, offline, no shared infra, no per-prototype network hop.
- **Con:** heavy first-run (Node toolchain + `pnpm install` + kit). This is the
  part `pat-manager` does *not* precedent — its server needs none of that. Every
  user's machine becomes a build host. Cold start is minutes, not seconds.
- **Open:** does Computer's environment even have Node/pnpm available to the
  agent's Bash tool? If not, A is dead on arrival.

### Option B — skill points at a hosted sidecar
One DevRev-hosted sidecar; the published skill just carries its URL + the arcade
instruction block.

- **Pro:** install is trivial (it's just instructions, like `make-page-interactive`).
  One place to update the kit. True "prompt → it works" parity.
- **Con:** needs a hosted service (uptime, auth, the kit lives server-side). This
  is exactly the **"host as a service"** row in `computer-sidecar-decision.md` —
  skill-publisher doesn't solve it, it *requires* it.
- **Open:** auth — the hosted sidecar compiles arbitrary `.tsx` the agent sends.
  Localhost binding made that safe (`127.0.0.1` only). A hosted one needs an auth
  story so it's not an open compile-anything endpoint.

### Option C — a Computer **desktop plugin** (Applied AI's plugin-builder)

Discovered 2026-06-03: the Applied AI team ships a **Computer NXT Desktop Plugins
Builder** (`devrev/aai-custom-computer-capabilities`, `3-computer-capabilities-nxt/
plugin-builder`). A "plugin" there is **not** a skill and **not** a canvas artifact
— it's a **standalone Electron app** that docks beside Computer, with a full Node
runtime. Its reference plugin (`execution-graph`) launches via `npm install` then
`npx electron .` and uses `child_process`/`execSync` freely.

This changes the analysis: the plugin **is** the local runtime. Our sidecar
compiler can run **as a process inside the plugin** — no core-Computer wiring, no
separate hosting box. And because a plugin is just an Electron window (not the
narrow side panel by default), it could be **both** the compiler **and** the render
surface — running the build and showing the full-size prototype + comment bar in
its own window.

- **Pro:** lowest dependency on the **core** Computer team — the plugin is
  self-contained. Kills Option A's blocking unknown ("does Computer have Node?") —
  the plugin *is* a Node/Electron app, it brings its own. Could bypass the
  read-only canvas entirely (own window). Whole loop in one installable.
- **Con:** still a **heavy per-machine install** (Tailwind v4 + esbuild + kit →
  a real `npm install` on first run, same weight as Option A). **macOS-only** —
  plugins rely on AppleScript + CGEvent + Accessibility permissions. Dependency
  **shifts** from core-Computer to the **Applied AI** team (their builder + its
  support), it doesn't vanish.
- **Communication note:** the plugin talks to Computer's agent through a documented
  **file bridge** (`~/.devrev/panel-bridge/inbox.json`) + simulated input — so the
  "send comments back to Computer to regenerate" loop has a real, supported channel,
  not a hack.
- **Open:** (1) can one Electron plugin window both run `packFromSource` AND render
  the 4MB interactive prototype cleanly? (the spike below). (2) how does a *built*
  plugin get distributed to other people — clone+run per user, or is there a
  publish path? Not spelled out in the builder docs. skill-publisher could ride on
  top.

## The three paths at a glance

| | Compiler runs… | Render surface | Core-Computer-team dependency | Cross-platform | Install weight |
|---|---|---|---|---|---|
| **A — skill bootstraps local sidecar** | user's machine (skill-launched) | Computer canvas | medium (canvas wiring) | macOS-first | heavy |
| **B — hosted sidecar** | DevRev server | Computer canvas | medium (canvas wiring) + infra owner | any | none (just a link) |
| **C — desktop plugin** | inside the plugin (own Node runtime) | the plugin's own Electron window (or canvas) | **low** (self-contained) — shifts to Applied AI team | macOS-only | heavy |

## The decision this forces

skill-publisher makes distribution *easy* only to the degree the sidecar is
*reachable*. So adopting it doesn't remove the hosting question from
`computer-sidecar-decision.md` — **it converts it from "nice to decide later"
into "must decide first."** The plugin path (C) is a genuine third answer that
mostly removes the *core* team from the critical path.

- If the answer is **hosted sidecar (B)**: skill-publisher is a clean,
  high-leverage distribution channel. Publish the arcade instruction-block skill
  pointing at the hosted URL; done. This is the "google-docs for prototypes"
  end-state — but it still needs core-Computer canvas wiring + an infra owner.
- If the answer is **bundle/local (A)**: skill-publisher can still bootstrap it,
  but the install is heavy and `pat-manager` is *not* the precedent for it — the
  precedent stops at "a skill can launch a process," not "a skill can stand up a
  Node build environment." Validate Node-in-Computer-Bash before betting on A.
- If the answer is **plugin (C)**: lowest core-team dependency and self-contained
  runtime, at the cost of a heavy macOS-only per-machine install and a new
  dependency on the Applied AI builder. **This is the path most aligned with
  "ship it without waiting on the core Computer team" — pending one buildable
  spike (below).**

## What's free *today*, regardless of the above

- **The Arcade skill (repo root)** can be published through skill-publisher right
  now — it's already pure instructions, no sidecar, no decision blocked. (It's
  the lower-fidelity one-off-HTML prototyper, not the kit-backed Studio output,
  but it ships with zero new work.)
- The **generate → comment → publish** loop is already proven end-to-end against
  a local sidecar (see integration plan, open questions 5 & 7 resolved live
  2026-06-02). Distribution is the only missing piece, and it's a hosting call,
  not a capability gap.

## Recommendation

1. **Don't conflate the two products.** "Publish Arcade as a skill" is two
   different projects — the easy one (root skill, ship now) and the hard one
   (kit-backed Studio, blocked on hosting).
2. **Plugin path (C) is the front-runner — gate PASSED (2026-06-03).** The
   compiler runs under Electron; distribution is solved by composing with
   skill-publisher (see "Combined architecture"). No core Computer team needed.
   The remaining work is packaging (esp. the private-kit-token problem), not
   feasibility. This is now the recommended direction to build toward.
3. **Take the hosting decision to the Computer runtime owner** for B as the
   fallback/parallel path: skill-publisher is the reason to decide, hosted-sidecar
   makes it a clean win — but it still needs core-team canvas wiring.
4. **Spike Node-in-Computer-Bash** only if local-bootstrap (A) is seriously on
   the table — it's the single fact that kills or enables A. (Note: the plugin
   path C makes this moot, since the plugin brings its own Node.)

## Combined architecture — skill-publisher delivers, plugin runs (Option C, end-state)

Two spikes + two repo reads converge on one clean design. Each piece does the one
thing it's good at; neither needs the core Computer team:

```
  ┌─ skill-publisher (Ribhu) ─────────┐     ┌─ desktop plugin (Applied AI pattern) ─┐
  │ DELIVERY                          │     │ RUNTIME                                │
  │ • user prompts "find arcade"      │     │ • self-installs: cp -R → ~/.devrev/    │
  │ • discovers published article     │ ──▶ │   plugins/arcade + npm install         │
  │ • article payload = the plugin    │     │ • runs packFromSource (compiler) — ✓   │
  │   folder + bootstrap instructions │     │   proven under Electron ABI            │
  │ • access control (me/team/org)    │     │ • renders prototype + comment bar in   │
  │ • analytics: who installed        │     │   its own window (own Chromium)        │
  └───────────────────────────────────┘     │ • file-bridge → sends comments back    │
                                             │   to Computer to regenerate            │
                                             └────────────────────────────────────────┘
```

**Why this is the strong end-state:**
- **Delivery** (the gap the plugin builder punts on) ← skill-publisher's whole job:
  publish once, anyone with access prompts Computer and gets it installed. Plus
  access control + install analytics for free.
- **Runtime** (the gap skill-publisher can't fill — it ships files, not a running
  compiler) ← the plugin, which carries its own Node/Electron and runs the heavy
  Tailwind+esbuild toolchain locally (Stage 1 proven).
- **The loop** (comment → regenerate) ← the documented file bridge
  (`~/.devrev/panel-bridge/`), a supported channel, not a hack.
- **Core Computer team dependency: none.** Render is the plugin's own window
  (bypasses the read-only canvas); delivery is skill-publisher; compile is local.

**What still has to be built (the real work, all self-serve):**
1. Package the compiler + **private-registry auth** (GitHub Packages token for
   `@xorkavi/arcade-gen`) + **Studio source slices** (`prototype-kit/`,
   `src/styles/`) into a portable plugin bundle. *(This is the bulk of it — see
   spike spec Stage 0 findings.)*
2. Scaffold the plugin per the builder SKILL.md (main.js, window, file bridge).
3. Confirm skill-publisher can carry a plugin folder + run a bootstrap on install
   (open q 8 — ask Ribhu).
4. Decide how the private-registry token reaches each user's `npm install`
   (the one genuinely thorny bit — a private kit + per-machine install don't love
   each other; may need a pre-bundled `node_modules` in the published payload
   instead of a live `npm install`).

**The remaining hard problem isn't capability — it's the private kit.** Everything
runs; the friction is that `@xorkavi/arcade-gen` is token-gated, so a per-machine
`npm install` needs credentials. Likely answer: **pre-bundle** `node_modules` into
the published plugin payload so the user's machine never authenticates to the
registry. That keeps the kit's source closed while shipping the built artifact —
worth validating early, it shapes the whole packaging step.

## Open questions

1. Does the Computer agent's Bash environment expose Node + pnpm? (Gates Option A;
   **moot for C** — the plugin is its own Node/Electron runtime.)
2. If hosted (Option B): where does the sidecar run, and what's its auth model for
   accepting `.tsx` to compile? (Inherits + sharpens `computer-sidecar-decision.md`.)
3. Does `internal-skill-publisher` support an install-time *bootstrap script*
   (run a command on install), or only "drop these files in the skills dir"? The
   former enables A; the latter means A needs a separate manual step and only B is
   truly one-prompt. (Ask Ribhu.)
4. Skill-evaluator gate: Ribhu's publisher calls `skill-evaluator`, which runs a
   security scan. A skill that shells out to `pnpm install` + boots a Node server
   may trip it. Confirm an instruction-only / URL-only skill (Option B) passes
   clean — likely yes, since it carries no executable bootstrap.
5. ~~**(Option C)** Can one Electron plugin both run `packFromSource` AND render
   the prototype?~~ **RESOLVED — compile half PASSED (2026-06-03).** The compiler
   (incl. native oxide + esbuild) runs under Electron 33's ABI with no rebuild,
   386ms, valid HTML. Render half is routine Electron (same Chromium that already
   rendered the published prototype), to confirm in Stage 2. See spike spec.
6. ~~**(Option C)** How is a *built* plugin distributed to other users?~~
   **RESOLVED (read of aai repo, 2026-06-03):** desktop plugins have **no formal
   distribution** — the reference plugin's setup just `cp -R`s the folder to
   `~/.devrev/plugins/` + `npm install` locally. Files must already be on the
   machine. → delivery is **not** an Applied AI feature; it's exactly the gap
   **skill-publisher** fills. See "Combined architecture" below.
7. **(Option C, still open)** Will the Applied AI team support a plugin that embeds
   a heavy build toolchain (Tailwind v4 + esbuild + arcade kit), vs. their light
   dashboards? Less critical now — the pattern is open and self-serve, so this is
   "will they help / bless it," not "can we do it." (Optional ask.)
8. **(Combined)** Does skill-publisher's payload mechanism carry a **plugin folder
   + bootstrap** (not just a skills-dir drop)? This is the same question as
   open-q3, now load-bearing for the plugin-delivery architecture. (Ask Ribhu.)
