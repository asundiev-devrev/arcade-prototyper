# Frame edit fidelity — "the kit is a default, your request is law"

**Date:** 2026-06-20
**Area:** `studio/` — generation prompt + chat middleware
**Status:** Design, pending implementation

## Problem

The single biggest source of beta-tester churn in Arcade Studio: **once a frame
is generated, it is very hard to change.** Two failure modes, both confirmed
against tester reports:

1. **Kit substitution.** The designer asks for something the kit has no slot for
   — a specific brand color, a custom element, an off-grid size — and the agent
   quietly does the kit-conformant version instead, or "snaps to the nearest
   token", ignoring the literal request.
2. **Phantom edit.** The agent replies "done / I changed X" but no file actually
   moved. The system detects this today but only surfaces it as a *post-turn
   warning* — the agent never learns mid-turn that its edit missed, so it can't
   self-correct.

These two together read to the user as "the agent and the system are stubborn —
it even claims it applied a change when it didn't."

## Goal (two-tier authority)

The product must satisfy two requirements that currently fight each other:

1. **Initial generation stays accurate** to the prompt and the input (Figma
   mockup / screenshot). The kit + design system + Figma remain law for
   everything the user did **not** explicitly specify. *This is unchanged — we
   must not regress it.*
2. **Any subsequent explicit change is implemented precisely**, even when it
   goes against the kit or the design system.

The reframe that reconciles them:

> **The kit is the default for what you did not specify. Anything you explicitly
> asked for is law — implemented literally, then flagged once as a deviation.**

### The honest technical boundary

Investigation of the runtime (Vite alias map, Cloudflare share bundler, Tailwind
v4 config, the import-validation hook) established the real ceiling:

- **Fully supported, in dev AND in shared builds:** hand-rolled `<div>`/`<svg>`,
  inline `style={{}}`, arbitrary Tailwind brackets (`w-[1040px]`, `bg-[#FF6B35]`),
  raw `<style>`, local `.css` imports. Nothing technical blocks a literal off-kit
  change — only the instructions do.
- **NOT supported:** importing an npm package not already installed (e.g.
  `lucide-react`, a charting library). esbuild fails to resolve it and the share
  build breaks. The `validateArcadeImports.mjs` hook (exit 2) also hard-blocks
  fake `arcade/*` imports and undefined capitalized JSX tags — but it does **not**
  block hand-rolled HTML/CSS.

So when a request needs a library we don't ship, the agent builds the closest
hand-rolled version and says so. Every other off-kit request is satisfiable
literally.

### Off-kit stance (decided)

When the user gives an explicit off-kit instruction: **obey, flag once.**
Implement the literal request exactly, add **one** `### Deviations` line noting
it is off-kit (and a cleaner kit alternative when one exists). No nagging, no
"are you sure?", no re-litigating on later turns.

## Why the rigidity exists today (root cause)

- `templates/CLAUDE.md.tpl` treats the kit as a **hard boundary**, not a default.
  ~20 passages say "the manifest is the API", "pick the nearest token", "hand-roll
  only as a last resort". The agent's strongest training is therefore to find the
  closest kit thing rather than build what was literally asked. (Note: R4 already
  says "an explicit request is never a gap — BUILD IT", but it is one rule
  drowned out by the surrounding closed-world language.)
- Phantom edits are caught by `frameChangeContract.ts` (before/after content-hash
  snapshot) but only **post-turn**, as the `NO_CHANGES_TRAILER` warning. There is
  no mid-turn correction path.
- Crucial lever: the codebase documents that **prompt-region text is obeyed hard,
  while CLAUDE.md text is obeyed loosely** (see the `KIT_MANIFEST_PATH` comment in
  `claudeCode.ts`). So the highest-leverage place to put the new rules is
  *prepended to the user prompt*, not only in CLAUDE.md.

## Design

Three pieces. They stack; each is independently shippable and testable.

### Piece 1 — Rewrite the kit rules (instructions only)

File: `studio/templates/CLAUDE.md.tpl`.

- Add a short **two-tier authority** principle near the top (Goal / "How to
  work" region), stated once and crisply: kit = default for the unspecified;
  explicit request = law, implemented literally, flagged once.
- Reframe the closed-world language (R2 imports, R3 tokens, "the kit can't
  express the request", the anti-patterns table) so it is unambiguous that those
  rules govern **gaps the agent is filling on its own**, NOT a change the user
  explicitly demanded.
  - **R3 (tokens)** gains an explicit-request exception: if the user names an
    exact color / size / radius, use it verbatim (inline style or arbitrary
    bracket) and add one deviation line. "Snap to nearest token" applies only
    when the agent is choosing, not when the user specified.
  - **R2 (imports)** stays as a stated technical fact — we cannot add code
    libraries — but reframed: when a request needs an uninstalled library,
    hand-roll the closest thing and flag it; do not refuse or stall.
- Strengthen the existing "Preserve existing inline styles on edits" section —
  it is the correct behavior and directly serves literal edits.
- Keep initial-generation fidelity rules (Figma is source of truth, match the
  reference's shape, don't invent content) **untouched** — they only ever apply
  to the unspecified, which the two-tier framing now makes explicit.

### Piece 2 — Phantom-edit auto-retry (server)

File: `studio/server/middleware/chat.ts` (+ a small pure helper, e.g.
`server/phantomEditRetry.ts`).

Today: agent claims a change, no file moved → `NO_CHANGES_TRAILER` warning, done.

New: when the post-turn diff shows **no file changed** AND the reply looks like a
real edit claim (has a `### Deviations` section / narration describing a change),
**re-spawn once** via the existing `runClaudeTurnWithRetry` / `--resume <sessionId>`
path, prepending a corrective message:

> Your last reply described a change to the frame, but no file was actually
> modified. Re-read the target frame file and apply the change now with Edit (or
> Write if Edit can't find a unique anchor). Do not describe the change again
> without making it.

Then re-snapshot. Only if it **still** didn't move do we emit the existing
warning trailer. A single narration ("Reapplying that change…") keeps it
transparent.

Guards (must NOT fire the retry):
- Intentional no-write turns: flow-shape questions, bare `remember:` turns, the
  "looks like a multi-step flow, want me to split?" reply. These legitimately
  produce no frame change — detect via the same signals the template uses.
- Already-retried this turn (one-shot, mirrors the stale-session one-shot guard).

This reuses the proven retry-with-resume machinery; it does not add a new
subprocess model.

### Piece 3 — Deterministic edit-discipline injection (server)

File: `studio/server/middleware/chat.ts` — a new enrichment sibling to
`enrichPromptWithFigmaContext`, e.g. `prependEditContext(prompt, project)`.

The right-click "edit this" preamble lives **client-side** (`PromptInput.tsx`) and
only fires on right-click. A *typed* edit ("make the header red") gets no
preamble and relies on the agent inferring intent from history — which is exactly
where both symptoms cluster.

New: when `project.frames` is non-empty (so we are in an established project,
deterministically an edit context) AND the prompt carries no client preamble,
**prepend** a compact `<edit_context>` block listing the existing frames + the two
hard rules:

```
<edit_context>
This project already has frames. Treat this turn as an edit unless the prompt
clearly asks for a brand-new screen.

- Anything the designer explicitly asks for is LAW. Implement it literally —
  exact color, exact size, hand-rolled element — even when it diverges from the
  kit or design system. Flag the divergence in ONE ### Deviations line; do not
  substitute the kit version or "snap to the nearest token".
- A reply that describes a change without a corresponding Edit/Write tool call is
  a FAILED turn. Re-read the file, make the real edit, then reply.

Existing frames: <slug list>
</edit_context>
```

Because prompt-region text is obeyed harder than CLAUDE.md, this fires the rules
automatically on every typed edit, no right-click required, no client change.

### Tests

Mirror existing `__tests__` patterns:
- Piece 2: pure `shouldRetryPhantomEdit(diff, narration)` helper → unit test the
  fire/skip matrix (no change + edit claim → retry; no change + flow question →
  skip; change present → skip; already retried → skip).
- Piece 3: pure `prependEditContext` → unit test (frames present + no preamble →
  block injected with slug list; no frames → unchanged; client preamble present →
  unchanged, no double-injection).
- Piece 1: a guard test asserting the two-tier principle text survives in
  `CLAUDE.md.tpl` (cheap regression catch, same spirit as
  `select-item-empty-value.test.ts`).

## Out of scope

- Installing new npm libraries on demand (charting, icon sets) — separate, larger
  change to the bundle.
- A user-facing "strict kit / free mode" toggle — the two-tier principle removes
  the need; revisit only if testers ask.
- Changing the right-click preamble or any client component.

## Risks / watch-items

- **Regressing initial fidelity.** Mitigated by making the two-tier split
  explicit: the kit-strict rules are scoped to "what you didn't specify", which
  is precisely the initial-generation case. The guard test pins the principle.
- **Over-flagging deviations.** "Flag once" + the existing 5-bullet cap keep the
  Deviations section scannable.
- **Auto-retry latency.** One extra spawn only on a detected phantom edit — a
  case that today fails the user entirely, so the trade is strongly positive.
- **0.38.0 releasing in parallel.** This work touches `CLAUDE.md.tpl`, `chat.ts`,
  and new files under `server/` + `__tests__/` — coordinate the merge; no overlap
  expected with the templates/homepage work in 0.38.0.
