# Arcade Studio — Pixel-Precision Handoff

Context for the next agent picking this up. Read before doing anything.

## The goal

Arcade-studio is a Claude-Code–backed tool that takes a Figma URL and generates a React frame in `arcade-gen` that matches the design **pixel-for-pixel**. The designer's acceptance criterion: generate the UI from Figma and have it match the Figma original exactly. Task is not done until that's true.

## The specific test case

- Figma URL: `https://www.figma.com/design/oDrjVWAS6OxNOziFAMN7j6/AS---Settings?node-id=11001-63507&t=Lkgi5WoRHyxUARGM-4`
- Figma node ID: `11001:63507` (Desktop App frame, 1680×1050)
- Designer runs this same URL every iteration — do NOT re-fetch/search, just re-use it.

## Repos and paths

- `/Users/andrey.sundiev/arcade-gen` — the design-system + studio repo. All code changes land here.
  - `arcade-gen/studio/templates/CLAUDE.md.tpl` — system prompt template rendered into every project's CLAUDE.md
  - `arcade-gen/studio/server/middleware/chat.ts` — chat API entry point
  - `arcade-gen/studio/server/plugins/frameMountPlugin.ts` — mounts generated frames
  - `arcade-gen/studio/src/frame/FrameErrorBoundary.tsx` — surfaces runtime errors to the iframe
  - `arcade-gen/src/components/index.ts` — arcade component barrel
  - `arcade-gen/src/tokens/generated/light.css`, `dark.css` — design tokens
- `/Users/andrey.sundiev/figma-cli` — local CLI the agent uses to read Figma. **Don't patch — designers need latest upstream.**
- `/Users/andrey.sundiev/Library/Application Support/arcade-studio/projects/<slug>/` — per-project data (CLAUDE.md, frames, chat-history, project.json, theme-overrides.css)

## How to run an end-to-end test

Studio runs on `http://localhost:5556`. Check it's up:
```
rtk proxy curl -s http://localhost:5556/api/projects
```

Full flow:
```
# Delete old, create new (fresh CLAUDE.md from template)
rtk proxy curl -s -X DELETE http://localhost:5556/api/projects/<old-slug>
rtk proxy curl -s -X POST http://localhost:5556/api/projects -H "Content-Type: application/json" \
  -d '{"name":"<slug>","theme":"arcade","mode":"light"}'

# Trigger generation (background — takes 3-8 min)
rtk proxy curl -sN -X POST http://localhost:5556/api/chat -H "Content-Type: application/json" \
  -d '{"slug":"<slug>","prompt":"Generate a frame from https://www.figma.com/design/oDrjVWAS6OxNOziFAMN7j6/AS---Settings?node-id=11001-63507&t=Lkgi5WoRHyxUARGM-4"}'

# Screenshot rendered frame (Playwright MCP is broken; use headless Chrome)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars \
  --window-size=1440,900 --screenshot=/tmp/frame.png "http://localhost:5556/api/frames/<slug>/01-agent-settings"

# Export Figma reference
cd ~/figma-cli && node src/index.js export node "11001:63507" --output /tmp/reference.png
```

The template only refreshes when the project's CLAUDE.md content differs from the current template OR on vite startup. To force a refresh for an existing project, delete and recreate it.

## Infrastructure gotchas (save time)

- **rtk (Rust Token Killer)** wraps most shell commands. It mangles curl JSON and grep with complex regex. Use `rtk proxy <cmd>` to bypass.
- **Playwright MCP is broken.** Both `mcp__plugin_playwright_*` and `mcp__plugin_devrev_playwright_*` return "Target page, context or browser has been closed". Fallback: headless Chrome command above.
- **figma-cli `get` / `eval` often time out (`spawnSync ETIMEDOUT`)** when Figma desktop is under load. First run `status` to warm the connection, then retry. If `eval` persistently times out, start the daemon: `cd ~/figma-cli && node src/index.js daemon start` (haven't verified this subcommand).
- **figma-cli `node tree` truncates text at ~35 chars** with `…`. That ellipsis is NOT in the design.
- **figma-cli tree output does NOT show instance `componentProperties` or overridden text `characters`.** So for any INSTANCE whose designer-facing content is driven by props (buttons, toggles, tags), the tree only says what component is there, not what text/variant the designer picked.
- **The error message "Use --depth to limit or --force to override" is a lie** — figma-cli does NOT accept `--force`. Use per-section reads if the 500-node limit bites.
- **Instance child IDs are prefixed:** `I<instance>;<child>`. Use them verbatim when drilling — never reconstruct.

## Template rules added so far

Located in `arcade-gen/studio/templates/CLAUDE.md.tpl`. Three systemic rules added in this iteration:

1. **Never invent a token name.** Canonical token list with Figma → token mapping. Key tokens the agent kept hallucinating: `--border-default` (doesn't exist), `--surface-default` (doesn't exist). Real ones: `--stroke-neutral-subtle`, `--fg-neutral-subtle`, `--surface-overlay`. File lists all real fg/bg/stroke/surface tokens.

2. **Implement the WHOLE frame, including app chrome.** If Figma includes Sidebar, Page Header, Breadcrumbs, render them with arcade `Sidebar`, `Breadcrumb`, `IconButton` — don't ship only the content area.

3. **Reading instance overrides.** For any INSTANCE with variants/label overrides, run `figma-cli eval` to fetch `componentProperties` and `n.findAll(x => x.type === "TEXT").map(x => ({id, chars}))` before rendering. Plus Figma → arcade component mapping table (Button/Link → `Link`, Toggle/OnOff → `Switch`, etc.) to prevent hand-rolled `<button>`.

## What works now (validated end-to-end)

Generated file: `.../test-styles/frames/01-agent-settings/index.tsx`. Compared against `/tmp/reference.png`.

- ✅ Sidebar rendered (arcade `<Sidebar>`)
- ✅ Page Header with `<Breadcrumb>` + `<IconButton>` icons
- ✅ Stroke uses `--stroke-neutral-subtle` (was pure black before)
- ✅ Secondary text uses `--fg-neutral-subtle` (was pure black before)
- ✅ Arcade `<Switch>` (yellow, matches arcade theme)
- ✅ Arcade `<Button>` used instead of raw `<button>`
- ✅ Uses `--surface-overlay` instead of hallucinated `--surface-default`

## What's still broken — content hallucination

All remaining gaps are **text content**, not structure or style. The agent invents labels when it can't read them.

**Confirmed hallucinations:**

| Location | Generated (wrong) | Figma truth |
|---|---|---|
| Page title | `CX Agent` | `Agent Settings` |
| LLM model row right side | `Claude` + `Sonnet` pill | `Button` + `Button ↗` pill |
| Streaming row right side | `Adaptive` | `Read only` |
| Thinking row right side | `Budget` | `Manage` |
| Retry policy row right side | `Budget` | `Manage` |
| Teams row right side | `Budget` | `Manage` |
| Behaviour row 1 label | `Context Memory` | `Max tool calls per turn` |
| Behaviour row 2 label | `Proactive` | `Retry policy` |
| Channel row 1 label | `Auto-response` | `Trigger channels` |
| Channel row 2 label | `Slack` | `Teams` |

**Why:**

1. **"Agent Settings" is an instance override.** The Page Header instance's `characters` in Figma is set to "Agent Settings". But `node tree` prints the component's **default** text, which is "CX Agent". So following the rule "only render what the tree shows" still produces wrong text.
2. **Button labels are also instance overrides** on the "Button / Default" and "Button / Link" instances inside each Contained Row. Same problem.
3. **Row labels (Max tool calls per turn, Retry policy, etc.) are instance overrides on _another_ "Form / Section Title" or similar.** Tree shows the component default.
4. **Agent's own explicit behavior:** narration said `"I'll use reasonable defaults for the truncated content"`. The "STOP, don't invent" rule in the template is being ignored under time pressure.

**Session logs showed:**
- 13× `node tree` calls, 2× `eval` calls — eval rule not consistently followed
- "Agent Settings" appears 0× in session, "CX Agent" appears 3× — tree literally never showed the real title
- "Manage", "Button", "Retry policy", "Max tool calls" all appear 0× — never seen

## Approaches for the next round

Pick one. Don't try multiple without reporting back.

**Option A — Image cross-check as a mandatory gate.**
Template rule: before writing any text to the frame, export the parent node as PNG, look at it, and verify every label you're about to write appears in the image. Zero changes to figma-cli. Relies on the agent's vision capability being reliable (it is — that's how we manually diff).

**Option B — Wrap figma-cli in a helper that does eval auto-resolution.**
Create a script in `arcade-gen/studio/server/` (or in the project's sandbox) that wraps `node tree` and post-processes the output: for every INSTANCE node, fire a second `eval` to fetch componentProperties + text characters, and splice those into the tree output. Agent uses the wrapper, sees real content inline. No upstream figma-cli changes. This is the highest-leverage fix because it eliminates the need for discipline — agent literally can't see bad data.

**Option C — Stronger template rule on eval usage.**
Rewrite the rule to say "EVERY instance of type Button, Toggle, Tag, Input, Select — no exceptions — must be eval'd before rendering. If you render a component without running eval on it, the frame is wrong." Testing showed the current rule isn't strong enough — agent runs eval twice in 13 tree calls.

**Option D — Add a post-render verification pass.**
After writing the frame, diff the screenshot against the Figma export image and feed the diff back into a second chat turn. This is the nuclear option — always works, slow.

Designer's preference signals so far:
- **No patching figma-cli** (wants designers on latest upstream)
- **Use Storybook / story files for component inventory**, not a hand-maintained list
- Strong dislike for "try something without end-to-end verification"

## Files to read before starting

1. `/Users/andrey.sundiev/arcade-gen/studio/templates/CLAUDE.md.tpl` — current template with the 3 rules
2. `/Users/andrey.sundiev/Library/Application Support/arcade-studio/projects/test-styles/frames/01-agent-settings/index.tsx` — latest generated frame (the one that's wrong in the ways listed above)
3. `/tmp/frame-v2.png` — latest rendered screenshot of that frame
4. `/tmp/full-desktop.png` — Figma reference export
5. `/tmp/contents.png` — Figma Contents-only export (no chrome) with crisp view of real labels

## Commit discipline

Nothing is committed. The template edits (`CLAUDE.md.tpl`) are uncommitted in the arcade-gen worktree. If the next round goes well, bundle the template rules + any tooling changes as one commit with a message explaining the hallucination class they fix.
