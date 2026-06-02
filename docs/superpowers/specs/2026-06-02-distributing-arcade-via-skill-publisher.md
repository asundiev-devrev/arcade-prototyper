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

## The decision this forces

skill-publisher makes distribution *easy* only to the degree the sidecar is
*reachable*. So adopting it doesn't remove the hosting question from
`computer-sidecar-decision.md` — **it converts it from "nice to decide later"
into "must decide first."**

- If the answer is **hosted sidecar (B)**: skill-publisher is a clean,
  high-leverage distribution channel. Publish the arcade instruction-block skill
  pointing at the hosted URL; done. This is the "google-docs for prototypes"
  end-state.
- If the answer is **bundle/local (A)**: skill-publisher can still bootstrap it,
  but the install is heavy and `pat-manager` is *not* the precedent for it — the
  precedent stops at "a skill can launch a process," not "a skill can stand up a
  Node build environment." Validate Node-in-Computer-Bash before betting on A.

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
2. **Take the hosting decision to the Computer runtime owner now**, framed by
   this doc: skill-publisher is the reason to decide, hosted-sidecar (B) is the
   path that makes it a clean win.
3. **Spike Node-in-Computer-Bash** only if local-bootstrap (A) is seriously on
   the table — it's the single fact that kills or enables A.

## Open questions

1. Does the Computer agent's Bash environment expose Node + pnpm? (Gates Option A.)
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
