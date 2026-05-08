# FrameLink navigation

**Status:** design
**Date:** 2026-05-08
**Scope:** `studio/`

## The problem

0.13.0 ships multi-frame flows: a user types "a 4-step onboarding", the agent splits it into four frames, the viewport shows them side-by-side. Working as intended — except the frames are fully isolated. Nothing the user put in the prompt about *interaction between* the frames ("clicking the skill card opens the modal", "clicking Edit goes to settings") gets implemented. The output is visually correct but behaviorally dead.

Beta feedback example:

> Prompt: "1. Skills gallery page. 2. Click any skill card → skill modal. 3. Click Edit → skill settings."
>
> Agent produced 3 frames. No navigation wired — clicking a card in frame 1 does nothing.

Root causes:
- No primitive in `prototype-kit` for inter-frame navigation. The agent has no `<Button>`-equivalent for "go to frame N".
- Each frame mounts in its own iframe (`studio/server/plugins/frameMountPlugin.ts`). They don't share a React tree or a router.
- `CLAUDE.md.tpl` doesn't mention navigation at all.

## Solution in one sentence

Add a `<FrameLink target="02-skill-modal">` primitive that the agent wraps around any element the user's prompt names as a transition trigger; the parent viewport scrolls to the target frame and flashes a highlight.

## Out of scope

- **Visual connectors / arrows between frames.** Same rationale as the 0.13.0 spec: auto-drawn arrows misrepresent relationships the designer didn't ask for. `FrameLink` is invisible; the "flow" only shows when you click.
- **Preview mode toggle.** No alternative "one-frame-at-a-time" view. Side-by-side stays the only layout. Revisit if beta users ask.
- **Back button / history stack.** If the user wants back navigation in a prototype, the agent wires a back link explicitly (an `X` in the modal that `<FrameLink target="01-skills-gallery">`). No router state to manage.
- **Transition animations beyond the highlight flash.** Scroll IS the transition. No fade, no slide.
- **A visible affordance marking "this element is a link".** Intentionally invisible — the agent renders the element as designed and `FrameLink` adds only a pointer cursor. Revisit if beta users ask.
- **Hotkey / shell-driven navigation.** Frames drive navigation; the shell doesn't.
- **Deep-linking via URL to start at a specific frame.** Not needed.

## Design

Three coordinated changes:

### A. `<FrameLink>` primitive

New file: `studio/prototype-kit/composites/FrameLink.tsx`. Exported from `studio/prototype-kit/index.ts` alongside the other composites. The agent imports it as `import { FrameLink } from "arcade-prototypes";`.

**Shape:**

```tsx
<FrameLink target="02-skill-modal">
  <SkillCard name="Research" />
</FrameLink>
```

**Behavior:**
- Renders `<div role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={...} onKeyDown={...}>{children}</div>`. `role="button"` + `tabIndex={0}` gives keyboard users the same affordance as mouse users; Enter and Space trigger the same action.
- `onClick` calls `window.parent.postMessage({ type: "arcade-studio:navigate", target: "02-skill-modal", source: <currentFrameSlug> }, "*")`. Source slug is derived the same way `gestureForwarder.ts` derives it: from the iframe URL.
- No internal state. No styling beyond cursor + a `display: contents`-style pass-through wrapper so the wrapped element's layout isn't disturbed. (Implementation detail: if `display: contents` breaks click detection in some browsers, fall back to `display: inline-block` for phrasing content and `display: block` for block content — we'll decide in the plan.)
- Props:
  - `target: string` — frame slug (e.g. `"02-skill-modal"`). Required.
  - `children: ReactNode`. Required.

**Stacking with existing click handlers:** the wrapper's onClick fires first (outer), the child's existing onClick fires next (bubble). Common case (navigation-only) needs no coordination. If the child calls `e.stopPropagation()`, navigation is blocked — acceptable for v1.

### B. Parent-side navigation handler

New listener in `studio/src/components/viewport/Viewport.tsx`. When a `message` event with `type: "arcade-studio:navigate"` arrives:

1. Find the target frame's DOM element. Each `FrameCard` gets a `data-frame-slug={f.slug}` attribute so the viewport can `querySelector('[data-frame-slug="..."]')` directly.
2. If the target doesn't exist on disk, log `[Viewport] FrameLink target "XX" not found` to the dev console and flash a red 2px outline on the *source* frame for 400ms. User sees a visible "something was wrong" signal.
3. If the target exists but is already within the visible viewport bounds, skip the scroll — just flash the highlight.
4. Otherwise call `element.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })`. Browser handles the easing. At high zoom levels this can be a long sweep; acceptable for v1.
5. After scroll completes (300ms timer — `scrollIntoView` doesn't have a completion event), apply the highlight class. Use `--component-button-primary-bg-idle` (same blue as the resize handle hover state) as a 2px outline: 200ms fade-in, 500ms hold, 400ms fade-out. Total 1.1s.

Implementation detail: the highlight is a CSS class toggle on the `FrameCard`'s outer wrapper. The fade is `transition: outline-color 200ms ease` with the outline width always 2px but the color alternating between `transparent` and the accent.

### C. Agent prompt rule

New subsection in `studio/templates/CLAUDE.md.tpl`, placed inside the existing "When the prompt describes a flow" section (0.13.0 shipped that section). Title: **"Wiring the flow"**.

Content (~25 lines):

1. **The rule:** *When the prompt explicitly names an element that should navigate to another frame, wrap that element in `<FrameLink target="NN-slug">`. If the prompt doesn't name a trigger, don't wrap.*
2. **Signal patterns:**
   - "click X and Y happens" → wrap X, target Y's frame.
   - "clicking the card opens the modal" → wrap each card in the list.
   - "pressing Save goes to the confirmation" → wrap the Save button.
3. **Import:** `import { FrameLink } from "arcade-prototypes";`
4. **Slug source:** use the slug you assigned at split time (e.g. `01-skills-gallery`). It's valid even if the target frame's file hasn't been written yet.
5. **When the prompt is silent about triggers**, don't invent them. Record "no navigation wired — prompt didn't specify triggers" as a bullet in the `### Deviations` section. Matches the existing "don't invent content" rule.
6. **Worked example** (inline in the template):

   ```tsx
   // Prompt: "Click any skill card → opens the skill modal. Click Edit → settings."
   // Frame 01-skills-gallery writes:
   <FrameLink target="02-skill-modal">
     <SkillCard name="Research" />
   </FrameLink>

   // Frame 02-skill-modal writes:
   <FrameLink target="03-skill-settings">
     <Button>Edit</Button>
   </FrameLink>
   ```

7. **Anti-pattern (goes in the template's existing "Concrete anti-patterns" table):**

   | Anti-pattern | What's wrong | Do instead |
   |---|---|---|
   | Wrapping every button in `<FrameLink>` because "this is a multi-frame flow" | Navigation is specific to the prompt's instructions, not a general property of flows. | Only wrap elements the prompt names as triggers. If the prompt doesn't name the trigger, don't wrap. |

## Success criteria

Fresh project, prompt similar to the beta example:

> "1. Skills gallery page in settings. 2. Click any skill card → skill modal. 3. Click Edit → skill settings."

1. Agent asks about splitting → user confirms.
2. Agent produces three frames (`01-skills-gallery`, `02-skill-modal`, `03-skill-settings`).
3. Agent reads interaction cues in the prompt and:
   - Wraps each skill card in frame 01 with `<FrameLink target="02-skill-modal">`.
   - Wraps the "Edit" button in frame 02 with `<FrameLink target="03-skill-settings">`.
4. User clicks a skill card in frame 01 → viewport horizontally scrolls to frame 02 and frame 02's border flashes blue for ~1s.
5. User clicks "Edit" in frame 02 → viewport scrolls to frame 03 with the same highlight.
6. Keyboard works: tab to the wrapped element, press Enter → same navigation.
7. If the agent's generated `target` references a missing frame, nothing crashes; source frame flashes red and a warning lands in the dev console.

## Risks

1. **Agent over-wraps.** The "prompt must name the trigger" rule + anti-pattern table should block this. Beta telemetry: if deviations sections start consistently not mentioning nav, we're probably over-wrapping silently.
2. **Agent under-wraps.** User prompts "3-step flow: gallery, modal, settings" without naming click targets. Agent correctly doesn't wrap. User expects nav to "just work". Mitigation: the `### Deviations` section surfaces "no navigation wired — prompt didn't specify triggers" so the user knows why.
3. **Scroll feels jarring at low zoom.** Centering a frame at 25% zoom sweeps a large visual distance. Acceptable for v1; `scrollIntoView({ behavior: "smooth" })` gives browser-native easing.
4. **`display: contents` wrapper quirks.** Some browsers historically drop click handlers on `display: contents` elements. Mitigation: fall back to `display: inline-block` or block-level wrapping if we see issues in manual QA. Decide in the plan after testing.
5. **Click handler stacking.** If the wrapped child calls `e.stopPropagation()`, navigation is blocked. Agent-generated frames almost never use `stopPropagation`; the common case works. Template anti-pattern note added if we see this in practice.
6. **Manual-delete / rename.** User renames a frame slug on disk; existing `FrameLink target="..."` in other frames break silently. The parent-side "target not found" warning + source-frame flash gives a visible signal.

## Files touched (approximate)

- `studio/prototype-kit/composites/FrameLink.tsx` — new, ~40 lines.
- `studio/prototype-kit/index.ts` — export `FrameLink`.
- `studio/prototype-kit/KIT-MANIFEST.md` — add a `FrameLink` entry with prop type, usage example, and anti-pattern.
- `studio/src/components/viewport/Viewport.tsx` — add the `message` listener, scroll + highlight logic, `data-frame-slug` attribute wiring.
- `studio/src/components/viewport/FrameCard.tsx` — accept and render `data-frame-slug` attribute.
- `studio/src/components/viewport/frameHighlight.module.css` (or inline) — highlight animation styles.
- `studio/templates/CLAUDE.md.tpl` — new "Wiring the flow" subsection (~25 lines) + anti-pattern row.
- Tests:
  - `studio/__tests__/prototype-kit/frame-link.test.tsx` — component tests (renders children, onClick posts message, Enter/Space trigger nav).
  - `studio/__tests__/components/viewport-frame-link-nav.test.tsx` — parent-side message handler (unknown target flashes source, known target scrolls + highlights).
- `studio/CHANGELOG.md` — 0.14.0 entry.
- `studio/packaging/VERSION` — bump to 0.14.0.

## Versioning

This is a new user-facing feature. Bump to **0.14.0** (not 0.13.2) — it's an additive feature, not a patch. Matches the convention established in 0.12 → 0.13 for "meaningful batch of work".
