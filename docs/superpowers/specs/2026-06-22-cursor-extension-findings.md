# Arcade Studio as a Cursor / VS Code Extension — Feasibility Findings

**Date:** 2026-06-22
**Status:** Paused for strategic reassessment
**Branch:** `feat/cursor-extension` (26 commits, clean)
**Spec:** `2026-06-20-cursor-extension-design.md` · **Plan:** `../plans/2026-06-20-cursor-extension.md`

## TL;DR

We built a working VS Code/Cursor extension that boots the real Arcade Studio
generator inside the editor. The **engine works** — it installs, launches,
generates frames with DevRev fidelity. But a class of bugs surfaces **only in
the actual editor webview** and not in any environment we can test locally, and
they trace to one architectural choice: running the Studio app as a
**cross-origin iframe nested inside a VS Code webview**. After 8 fix rounds with
a beta tester, the webview-specific issues (chat-template squish, paste, font
glitch) have not converged. Recommendation: decide whether the nested-iframe
architecture is worth the "webview rendering tax" before investing further.

## What was built (and works)

The "shared core, two shells" design held up well:
- Extension host boots the existing Vite middleware server on a dynamic port;
  a webview editor tab frames `http://localhost:PORT`.
- Reuses the Studio server, React shell, prototype-kit, claude-CLI generation,
  Figma import — no fork.
- VSIX packaging solved real hard problems: pnpm symlink forest → **hoisted
  production install** (246 MB bootable VSIX); vendored claude/aws/figmanage;
  Gatekeeper GO (Developer-ID signed); keychain top-level-await crash fixed.

### Confirmed working (verified on the packaged VSIX)
- Installs + launches in Cursor; server boots; frames generate.
- **Delete / rename projects** — fixed (native `confirm`/`prompt` are no-ops in
  a webview; replaced with in-app design-system Modals). Verified by the tester.
- **Stop button** — fixed (was a hand-rolled `<button>` with Tailwind v4
  CSS-var shorthand classes the build doesn't generate; now an arcade-gen
  `<Button>`). Verified by the tester.
- **Settings + Agent Builder templates** — render correctly in the webview.
- Studio (the standalone Electron app) is **unaffected** by all changes — the
  shared-core edits are backward-compatible.

## What breaks — only in the real editor webview

These reproduce on the tester's machine but **NOT** in local Chromium
(Playwright), even when we matched the exact window width (977px) and
`devicePixelRatio` (2.4). That gap — Playwright's Chromium vs the editor's
Electron webview — is why fixes couldn't be verified before shipping.

### 1. Chat template squishes; elements missing (root-caused)
- The `Computer: Chat` template (kit composites `ComputerScene` / `ComputerPage`)
  collapses its sidebar via **CSS container queries** (`@max-[600px]` against an
  `@container` root). In the webview's nested iframe the `@container` element
  **mis-measures as < 600px** despite the frame being 1490px wide, so the
  sidebar collapses → squished nav, dropped mac-window dots / preview card /
  max-width container.
- **Proof it's container queries:** Settings + Builder templates use **zero**
  container queries and render perfectly. The chat template is the only one that
  does, and it's the only one that breaks. The tester's screenshot shows exactly
  the `@max-[600px]` collapsed state.
- Not reproducible in Playwright even at 977px / DPR 2.4 → webview-engine-specific
  container-query sizing inside a nested iframe.

### 2. Paste (incl. Figma links) doesn't reach the inputs
- VS Code intercepts Cmd+V before it reaches the cross-origin localhost iframe.
- We built a clipboard bridge (keybinding → `vscode.env.clipboard` → postMessage
  → iframe inserts at caret). It did not land for the tester. The likely cause —
  the `activeWebviewPanelId` keybinding context isn't set when focus is inside
  the nested iframe — could not be confirmed because the devtools console
  context could not be reliably switched into the innermost frame.

### 3. Font glitch
- Chip variable font occasionally mis-renders a glyph ("comp**''**ter" for
  "computer") in the webview. Not seen in local renders.

## Root pattern

All three live failures share one cause: **the Studio app is a cross-origin
iframe nested inside a VS Code webview.** That nesting is what intercepts
keyboard/paste, what distorts container-query measurement, and likely what
affects font shaping. It is also un-debuggable from our side: we can't reach the
innermost frame's console reliably, and Chromium ≠ the editor's webview, so the
local repro loop is blind exactly where the bugs are.

## Wasted-motion lessons (for whoever picks this up)

- **Verify on the artifact in the real host, early.** Every webview bug was
  invisible in dev and in Playwright. A real-Cursor smoke loop should be step 1,
  not step N.
- **One self-inflicted regression:** a `width=device-width` viewport meta added
  to "fix zoom" inflated the iframe to device-pixel width (1438px in a 977px
  pane) — it made rendering worse. Removed. Don't add viewport metas to a
  webview host.
- **Version every build.** Shipping repeated `0.39.0` VSIXes made reinstalls
  silently reuse the cached extension; the tester retested stale code for
  multiple rounds. Bump the version on every test build (now 0.40.0).

## Options from here

1. **Reassess the approach (recommended).** The nested-iframe-in-webview tax is
   real and recurring. Weigh it against the original goal — lowering the "I don't
   have time to learn a new tool" barrier — and consider alternatives:
   - **(a) Drop the nested iframe:** serve the shell as the webview's *own*
     content (same-origin), no inner iframe. Plausibly fixes paste + container
     queries + fonts at once, but is a real rework of the host + how frames mount.
   - **(b) Reduce Studio's own onboarding friction** (faster first-run, in-app
     guidance) instead of porting into the editor — may address churn more cheaply.
   - **(c) Keep the extension as "generate, then view in browser"** — sidestep
     the webview-rendering issues by opening previews in a real browser tab.
2. **Continue patching in-webview** — only viable with a live debugging loop on
   a real Cursor instance (tester drives devtools in the innermost frame), since
   nothing reproduces locally. Higher cost, uncertain convergence.

## Branch disposition

`feat/cursor-extension` is clean with all working fixes committed. The
engine + packaging are reusable regardless of which option is chosen. Nothing
here regresses the standalone Studio app.
