# Computer × Arcade Studio Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a desktop Computer user type `@Arcade <prompt>` and get a full-fidelity Arcade prototype rendered on Computer's canvas — natively, no separate Studio app.

**Architecture:** Agent-driven, sidecar-assisted. A tiny localhost HTTP service ("arcade-sidecar") in the arcade-prototyper repo exposes the already-proven `buildFrameBundle` packer (Tailwind v4 + arcade kit). When a turn is tagged `@Arcade`, Computer injects an "arcade prototype" instruction block into its existing agent (via the agent-runner `systemPromptSections` hook), gated behind a feature flag. The Computer agent writes a `.tsx` frame, calls the sidecar to compile it into one self-contained `.html`, writes that `.html` with its own Write tool, then runs the **make-page-interactive** skill over it in place to add the DevRev annotate/comment layer — so Computer's existing canvas tracks and renders the interactive page in the sandboxed iframe (the canvas auto-refreshes from disk on turn-complete). No new render surface in Computer; the Tailwind-v4 packer and the annotation runtime both stay in the skill/repo that already works. **Editing is out of scope for now** — the loop is comment → regenerate; true inline click-and-type editing is a later exploration (see Out of scope). **Sharing is opt-in**: when the `ui-publisher` skill is installed, the agent can publish a prototype to a DevRev link (personal / org-wide / public) on the designer's explicit request — never automatically.

**Tech Stack:** Node/TS (sidecar: http + existing `buildFrameBundle`), devrev-web Electron main (`apps/product-native`, webpack-bundled, Node 22), `@devrev-private/agent-runner` 0.1.78, React/arcade-gen kit.

**Why a sidecar (the hard constraint):** Arcade fidelity *requires* compiling React + Tailwind **v4**. devrev-web is locked on Tailwind **v3.4.3** and `@tailwindcss/node`/`oxide` are absent, so the packer cannot run inside Computer's own build. Per product decision, we call the existing packer as a local service now and vendor it into devrev-web later. Standalone Arcade Studio is unaffected — this reuses its code, doesn't replace it.

**Delivery:** Dev branch first (colleagues run the desktop Computer dev build + the sidecar locally). Native-package path kept open, not blocked on.

---

## Two-repo file map

**Repo A — `arcade-prototyper` (`/Users/andrey.sundiev/arcade-prototyper`)** — the sidecar lives here.
- Create: `studio/server/sidecar/arcadeSidecar.ts` — HTTP service exposing `POST /pack`.
- Create: `studio/server/sidecar/packFromSource.ts` — wraps `buildFrameBundle` to pack a `.tsx` string (no project on disk).
- Create: `studio/server/sidecar/bin.ts` — CLI entry (`node bin.ts --port 7799`).
- Create: `studio/__tests__/sidecar/packFromSource.test.ts`, `arcadeSidecar.test.ts`.
- Reuse (do not modify): `studio/server/cloudflare/bundler.ts` (`buildFrameBundle`), `studio/templates/CLAUDE.md.tpl` (the know-how), `studio/prototype-kit/` (the kit).

**Repo B — `devrev-web` (`/Users/andrey.sundiev/devrev-web`)** — the Computer-side wiring.
- Create: `apps/product-native/src/app/modules/computer-agent/arcade/arcadeInstructions.ts` — the system-prompt block + flag/URL plumbing.
- Modify: `apps/product-native/src/app/modules/computer-agent/computer-agent-module.ts` (config build site ~line 120; flags fn ~line 62) — register `systemPromptSections` + read the new flag/env.
- Modify: `libs/computer/shared/agent-chat-context/src/use-start-agent-chat.ts:~140` — detect `@Arcade` mention, set a request flag.
- Modify: `libs/electron/shared/data-models/src/types.ts:143` (`ComputerAgentRunRequest`) — add `arcadeMode?: boolean`.
- Modify: `apps/product-native/src/app/events/ipc/register-computer-agent-handlers.ts:92` — thread `arcadeMode` into the run.
- Test: colocated `*.spec.ts` next to each modified lib (follow nearest existing test).

---

## Phase 0 — De-risk the two unknowns BEFORE building

These two facts can still sink the design. Validate them with throwaway spikes; do not write production code until both pass. If either fails, STOP and report — the fallback is documented inline.

### Task 0.1: Confirm the agent can reach a localhost sidecar

**Files:**
- Create (throwaway): `/Users/andrey.sundiev/arcade-prototyper/tmp/poc-sidecar/echo-server.mjs`

- [ ] **Step 1: Stand up a trivial echo server**

```js
// tmp/poc-sidecar/echo-server.mjs
import http from "node:http";
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`echo:${body.length}`);
  });
}).listen(7799, "127.0.0.1", () => console.log("echo on 7799"));
```

- [ ] **Step 2: Run it**

Run: `node /Users/andrey.sundiev/arcade-prototyper/tmp/poc-sidecar/echo-server.mjs &`
Expected: `echo on 7799`

- [ ] **Step 3: In a desktop Computer dev session (with `UI_COMPUTER_NXT_ENABLED` on), send a chat asking the agent to fetch the sidecar.**

Prompt to type in Computer: `Use WebFetch to POST the text "hello" to http://127.0.0.1:7799 and tell me the exact response.`
Expected: agent reports `echo:5`. This proves the in-process WebFetch tool reaches localhost (the docs say WebFetch is NOT sandboxed; this confirms it empirically).

- [ ] **Step 4: Repeat using Bash curl**

Prompt: `Run: curl -s -X POST --data "hello" http://127.0.0.1:7799`
Expected: `echo:5`. If Bash is sandboxed and this FAILS but Step 3 passed, the plan uses WebFetch (Task 3 already does). If BOTH fail, STOP — localhost egress is blocked; fallback is Task 0.1b below.

- [ ] **Step 5: Record the result** in `tmp/poc-sidecar/RESULT.md` (which transport works). No commit (throwaway).

**Fallback 0.1b (only if both transports fail):** the sidecar must instead write directly into the agent's workdir, and Computer emits the file via the agent-runner's external-mutation API (`getUnreadExternalMutations` / `writeBytesToWorkdirFile`, exported by the runner). Document and escalate before pursuing — it's a larger Computer-side change.

### Task 0.2: Confirm an agent-written `.html` appears on the canvas

**Files:** none (manual validation in a Computer dev session).

- [ ] **Step 1: In a desktop Computer dev session, prompt the agent to write a self-contained HTML file.**

Prompt: `Write a file named prototype.html in your working directory containing: <!DOCTYPE html><html><body><h1 style="color:red">hello arcade</h1></body></html>`

- [ ] **Step 2: Observe the canvas / artifact side-panel.**

Expected: a `prototype.html` artifact chip appears under the turn, and clicking it renders red "hello arcade" in the sandboxed iframe. This confirms: a file written by the agent's Write tool is tracked (`status: 'created'`) and routed to `HtmlArtifactRenderer` via `kind === 'html'` (decided by `getFileKindFromName`).

- [ ] **Step 3: If the chip does NOT appear**, the file→canvas association needs a programmatic open. Fallback: after the turn, call `artifactViewer.openArtifact({ kind:'html', path, name, id }, chatId)` from the renderer. Note which path is needed and proceed; Task 4 covers wiring it.

- [ ] **Step 4: Record** pass/fail in `tmp/poc-sidecar/RESULT.md`.

**Gate:** Both 0.1 and 0.2 must pass (or their fallbacks be chosen) before continuing.

---

## Phase 1 — Arcade sidecar (repo A: arcade-prototyper)

### Task 1.1: Pack a `.tsx` string without a project on disk

**Files:**
- Create: `studio/server/sidecar/packFromSource.ts`
- Test: `studio/__tests__/sidecar/packFromSource.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/sidecar/packFromSource.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { packFromSource } from "../../server/sidecar/packFromSource";

describe("packFromSource", () => {
  it("packs a tsx string into one self-contained html", async () => {
    const tsx = `import * as React from "react";
import { Button } from "arcade/components";
export default function Frame() { return <Button variant="primary">Hi</Button>; }`;
    const html = await packFromSource({ tsx, mode: "light" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<div id=\"root\">");
    // css + js inlined, not linked
    expect(html).toMatch(/<style>[\s\S]+<\/style>/);
    expect(html).toMatch(/<script type="module">[\s\S]+<\/script>/);
    expect(html).not.toContain("/assets/bundle.js"); // self-contained, no external refs
  }, 120_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --config studio/vitest.config.ts __tests__/sidecar/packFromSource.test.ts`
Expected: FAIL — `Cannot find module '../../server/sidecar/packFromSource'`.

- [ ] **Step 3: Implement `packFromSource`**

It writes the tsx to a temp frame dir, calls the existing `buildFrameBundle`, then inlines css+js into one HTML string (the exact assembly proven in `__tests__/poc/computerCanvas.poc.test.ts`).

```ts
// studio/server/sidecar/packFromSource.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { buildFrameBundle } from "../cloudflare/bundler";

export interface PackInput {
  tsx: string;
  mode?: "light" | "dark";
  theme?: "arcade" | "devrev-app";
}

// Pack a single arcade frame (.tsx source) into one self-contained HTML
// string: css inlined in <style>, js inlined in a module <script>, no
// external asset references. This is what Computer's canvas iframe renders.
export async function packFromSource(input: PackInput): Promise<string> {
  const mode = input.mode ?? "light";
  const theme = input.theme ?? "arcade";
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arcade-sidecar-"));
  const frameDir = path.join(tmpRoot, "frames", "01-frame");
  await fs.mkdir(frameDir, { recursive: true });
  await fs.writeFile(path.join(frameDir, "index.tsx"), input.tsx, "utf-8");
  try {
    const bundle = await buildFrameBundle({
      projectSlug: "sidecar",
      frameSlug: "01-frame",
      framePath: frameDir,
      theme,
      mode,
    });
    return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" class="${mode}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${bundle.css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${bundle.js}</script>
  </body>
</html>`;
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --config studio/vitest.config.ts __tests__/sidecar/packFromSource.test.ts`
Expected: PASS (takes ~30–60s — runs real esbuild + Tailwind).

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/arcade-prototyper
git add studio/server/sidecar/packFromSource.ts studio/__tests__/sidecar/packFromSource.test.ts
git commit -m "feat(studio/sidecar): pack a tsx string into self-contained html"
```

### Task 1.2: HTTP endpoint `POST /pack`

**Files:**
- Create: `studio/server/sidecar/arcadeSidecar.ts`
- Test: `studio/__tests__/sidecar/arcadeSidecar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/sidecar/arcadeSidecar.test.ts
// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import { createSidecarServer } from "../../server/sidecar/arcadeSidecar";

let server: http.Server;
afterAll(() => server?.close());

function post(port: number, pathname: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

describe("arcade sidecar", () => {
  it("GET /health returns ok and POST /pack returns html", async () => {
    server = createSidecarServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;

    const tsx = `import * as React from "react";
import { Button } from "arcade/components";
export default function Frame() { return <Button variant="primary">Hi</Button>; }`;
    const res = await post(port, "/pack", JSON.stringify({ tsx, mode: "light" }));
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.html).toContain("<!DOCTYPE html>");
  }, 120_000);

  it("rejects missing tsx with 400", async () => {
    const port = (server.address() as any).port;
    const res = await post(port, "/pack", JSON.stringify({ mode: "light" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config studio/vitest.config.ts __tests__/sidecar/arcadeSidecar.test.ts`
Expected: FAIL — `createSidecarServer` not exported.

- [ ] **Step 3: Implement the server**

```ts
// studio/server/sidecar/arcadeSidecar.ts
import http from "node:http";
import { packFromSource } from "./packFromSource";

const MAX_BODY = 5 * 1024 * 1024; // 5MB tsx ceiling — frames are small

// Localhost-only HTTP service. POST /pack { tsx, mode?, theme? } -> { html }.
// Bound to 127.0.0.1 by the caller; never exposed off-host.
export function createSidecarServer(): http.Server {
  return http.createServer((req, res) => {
    const send = (status: number, obj: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
    if (req.method !== "POST" || req.url !== "/pack") return send(404, { error: "not_found" });

    let body = "";
    let tooBig = false;
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (tooBig) return send(413, { error: "payload_too_large" });
      let parsed: { tsx?: string; mode?: "light" | "dark"; theme?: "arcade" | "devrev-app" };
      try {
        parsed = JSON.parse(body);
      } catch {
        return send(400, { error: "invalid_json" });
      }
      if (!parsed.tsx || typeof parsed.tsx !== "string") {
        return send(400, { error: "missing_tsx" });
      }
      try {
        const html = await packFromSource({ tsx: parsed.tsx, mode: parsed.mode, theme: parsed.theme });
        return send(200, { html });
      } catch (err: any) {
        return send(500, { error: "pack_failed", message: err?.message ?? String(err) });
      }
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --config studio/vitest.config.ts __tests__/sidecar/arcadeSidecar.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add studio/server/sidecar/arcadeSidecar.ts studio/__tests__/sidecar/arcadeSidecar.test.ts
git commit -m "feat(studio/sidecar): localhost POST /pack http endpoint"
```

### Task 1.3: CLI entry so colleagues can launch the sidecar

**Files:**
- Create: `studio/server/sidecar/bin.ts`
- Modify: `package.json` (repo root) — add `"sidecar"` script.

- [ ] **Step 1: Implement the bin**

```ts
// studio/server/sidecar/bin.ts
import { createSidecarServer } from "./arcadeSidecar";

const portArg = process.argv.indexOf("--port");
const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 7799;

const server = createSidecarServer();
server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[arcade-sidecar] listening on http://127.0.0.1:${port}`);
});
```

- [ ] **Step 2: Add the run script**

In `/Users/andrey.sundiev/arcade-prototyper/package.json` `"scripts"`, add:

```json
"sidecar": "vite-node studio/server/sidecar/bin.ts --"
```

Note: if `vite-node` is unavailable, use the vitest-backed runner already proven in this repo, or `node --import tsx`. Verify `vite-node` resolves first: `pnpm exec vite-node --version`. If it errors, set the script to `"sidecar": "pnpm exec tsx studio/server/sidecar/bin.ts --"` and add `tsx` as a devDependency (`pnpm add -D tsx`).

- [ ] **Step 3: Manually verify it boots and packs**

Run: `pnpm run sidecar -- --port 7799 &` then
`curl -s -X POST http://127.0.0.1:7799/pack -H 'Content-Type: application/json' -d '{"tsx":"import * as React from \"react\";import {Button} from \"arcade/components\";export default function F(){return <Button variant=\"primary\">Hi</Button>;}","mode":"light"}' | head -c 120`
Expected: starts with `{"html":"<!DOCTYPE html>`.

- [ ] **Step 4: Commit**

```bash
git add studio/server/sidecar/bin.ts package.json
git commit -m "feat(studio/sidecar): cli entry + pnpm run sidecar"
```

---

## Phase 2 — Arcade instruction block (repo B: devrev-web)

The agent needs the arcade "know-how" so it writes valid arcade-kit frames and calls the sidecar. We adapt Studio's `CLAUDE.md.tpl` into a compact system-prompt section. Keep it self-contained (no file imports) — `systemPromptSections` output is plain text joined into the system prompt.

### Task 2.1: Author the arcade instruction provider

**Files:**
- Create: `apps/product-native/src/app/modules/computer-agent/arcade/arcadeInstructions.ts`
- Test: `apps/product-native/src/app/modules/computer-agent/arcade/arcadeInstructions.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// arcadeInstructions.spec.ts
import { buildArcadeSystemSection } from './arcadeInstructions';

const SCRIPT = '/skills/make-page-interactive/make-interactive.mjs';

describe('buildArcadeSystemSection', () => {
  it('returns empty string when arcade mode is off', () => {
    expect(buildArcadeSystemSection({ enabled: false, sidecarUrl: 'http://127.0.0.1:7799', makeInteractiveScript: SCRIPT })).toBe('');
  });

  it('includes the sidecar url and the pack workflow when enabled', () => {
    const out = buildArcadeSystemSection({ enabled: true, sidecarUrl: 'http://127.0.0.1:7799', makeInteractiveScript: SCRIPT });
    expect(out).toContain('http://127.0.0.1:7799/pack');
    expect(out).toContain('prototype.html');
    expect(out).toContain('arcade/components'); // teaches the kit import
  });

  it('wires the make-interactive step in place over prototype.html', () => {
    const out = buildArcadeSystemSection({ enabled: true, sidecarUrl: 'http://127.0.0.1:7799', makeInteractiveScript: SCRIPT });
    expect(out).toContain(SCRIPT); // the converter path is injected
    expect(out).toContain(`"${SCRIPT}" prototype.html prototype.html`); // overwrite in place
    expect(out).toContain('annotate/comment bar'); // explains what it does, in design terms
  });

  it('omits the publish block when ui-publisher is not installed', () => {
    const out = buildArcadeSystemSection({ enabled: true, sidecarUrl: 'http://127.0.0.1:7799', makeInteractiveScript: SCRIPT });
    expect(out).not.toContain('Sharing a prototype');
    expect(out).not.toContain('publisher.py');
  });

  it('includes an opt-in publish block when ui-publisher IS installed', () => {
    const PUB = '/skills/ui-publisher/scripts/publisher.py';
    const out = buildArcadeSystemSection({ enabled: true, sidecarUrl: 'http://127.0.0.1:7799', makeInteractiveScript: SCRIPT, publisherScript: PUB });
    expect(out).toContain('Sharing a prototype (ONLY when the designer asks)');
    expect(out).toContain(PUB); // the publisher path is injected
    expect(out).toContain('Do NOT publish automatically'); // opt-in is explicit
    expect(out).toContain('--access'); // teaches personal/internal/public
    expect(out).toContain('markdown_link'); // returns a clickable link, not raw URL
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec jest apps/product-native/src/app/modules/computer-agent/arcade/arcadeInstructions.spec.ts`
Expected: FAIL — module not found. (If the repo uses a different test cmd, use the one in the nearest existing `*.spec.ts`'s npm script; check `apps/product-native/project.json` `test` target.)

- [ ] **Step 3: Implement the provider**

```ts
// arcadeInstructions.ts
export interface ArcadeSectionInput {
  enabled: boolean;
  sidecarUrl: string;
  /** Absolute path to make-page-interactive/make-interactive.mjs in the agent's skills dir. */
  makeInteractiveScript: string;
  /**
   * Absolute path to ui-publisher/scripts/publisher.py in the agent's skills dir,
   * or undefined when the ui-publisher skill is not installed. When undefined, the
   * "share this prototype" capability is omitted from the prompt entirely (the
   * agent must not invent a publish command).
   */
  publisherScript?: string;
}

// Compact, self-contained system-prompt section that turns a normal Computer
// turn into an Arcade prototype turn. Adapted from arcade-prototyper's
// templates/CLAUDE.md.tpl — kept inline because systemPromptSections output is
// plain text, not a file import. When `enabled` is false, returns '' so the
// runner skips it.
export function buildArcadeSystemSection({ enabled, sidecarUrl, makeInteractiveScript, publisherScript }: ArcadeSectionInput): string {
  if (!enabled) return '';
  return [
    '# Arcade prototype mode',
    '',
    'This turn produces a visual UI prototype for a designer. Speed and visual fidelity matter more than completeness. Do NOT write planning docs; build directly.',
    '',
    '## Steps (follow exactly)',
    '1. Write the prototype as a single React component to `frame.tsx` in your working directory, using ONLY the arcade component kit. Import primitives from `arcade/components` (e.g. `import { Button, Input, Avatar, Tag } from "arcade/components"`) and page/composite templates from `arcade-prototypes` (e.g. `VistaPage`, `SettingsPage`, `SettingsCard`, `SettingsRow`, `NavSidebar`, `ComputerScene`). Default-export the component. Pick reasonable copy/icons; the designer iterates.',
    '2. Compile it: POST the FULL contents of `frame.tsx` as JSON `{ "tsx": "<file contents>", "mode": "light" }` to `' + sidecarUrl + '/pack`. Use the WebFetch tool (preferred) or, if unavailable, `curl`. The response is JSON `{ "html": "<self-contained html>" }`.',
    '3. Write the returned `html` value verbatim to `prototype.html` in your working directory using your Write tool. This file is what the designer sees on the canvas — it MUST be written by you (your Write tool), not by curl redirection, so it is tracked as an artifact.',
    '4. Make the prototype commentable: run the make-page-interactive skill over the file you just wrote, overwriting it IN PLACE so the tracked artifact updates and the canvas refreshes automatically:',
    '   `node "' + makeInteractiveScript + '" prototype.html prototype.html`',
    '   This wraps the page in the DevRev annotate/comment bar (defaults to passive View mode; the designer toggles Annotate to leave comments and @-mention you). Run it with the Bash tool. Do NOT read the output file back into context — it is large (~4MB); the canvas reads it from disk on its own.',
    '5. Reply to the designer in ONE sentence describing the screen, in design language (no file paths, no component prop names, no code). If anything diverged from the kit, add a short `### Deviations` list; otherwise append `### Deviations` then `None.`',
    '',
    // Publishing is OPT-IN, never automatic: it mints a DevRev article + link and
    // needs an access-mode choice. Only emit this block when the ui-publisher skill
    // is installed (publisherScript provided). Absent it, the agent has no publish
    // capability and must say so rather than invent one.
    ...(publisherScript
      ? [
          '## Sharing a prototype (ONLY when the designer asks)',
          'Do NOT publish automatically. Publish ONLY when the designer says something like "share this", "get me a link", "send this to <person/team>", or "make this public". Otherwise never run this.',
          'When asked:',
          'a. Pick the file to publish: prefer the interactive `prototype.html` (so reviewers get the comment bar) unless the designer explicitly wants a clean, non-commentable page.',
          'b. Ask which audience if not already clear: just the designer (`personal`), the whole org (`internal`), or anyone with the link for 7 days (`public`). If they named people/teams, use `personal` plus `--share-with-emails`/`--share-with-groups` and resolve names to DevRev emails/groups first (confirm if ambiguous).',
          'c. Run the publisher with the Bash tool (it reads `DEVREV_TOKEN` from env; never ask for a token in chat, never print it):',
          '   `python3 "' + publisherScript + '" --file prototype.html --name "<short page title>" --access <personal|internal|public> [--share-with-emails ...] [--share-with-groups ...]`',
          'd. The script returns JSON. Give the designer the `markdown_link` value as a clickable link — never the raw URL. For `public`, also tell them it expires (`expires_at`, ~7 days).',
          'e. If the script returns `{ "error": true }`, tell the designer plainly what failed (e.g. token missing/expired) and do not retry blindly.',
          '',
        ]
      : []),
    '## Rules',
    '- Never invent components outside the arcade kit. If unsure a component exists, choose the closest kit primitive.',
    '- If the /pack call returns an error, fix the reported issue in `frame.tsx` and retry once before reporting failure to the designer.',
    '- If the make-page-interactive step (4) fails, leave `prototype.html` as written in step 3 (a valid non-interactive prototype) and proceed to step 5 — do not block the designer on the comment layer.',
    '- Talk to the designer about colors, type, spacing, components, screens — never about files, tools, or terminal commands.',
  ].join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec jest apps/product-native/src/app/modules/computer-agent/arcade/arcadeInstructions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/andrey.sundiev/devrev-web
git add apps/product-native/src/app/modules/computer-agent/arcade/arcadeInstructions.ts apps/product-native/src/app/modules/computer-agent/arcade/arcadeInstructions.spec.ts
git commit -m "feat(computer-agent): arcade prototype system-prompt section"
```

---

## Phase 3 — Thread `@Arcade` from composer to the agent (repo B)

### Task 3.1: Add `arcadeMode` to the run request type

**Files:**
- Modify: `libs/electron/shared/data-models/src/types.ts:143` (`ComputerAgentRunRequest`)

- [ ] **Step 1: Add the optional flag**

In the `ComputerAgentRunRequest` interface (around line 143), after `planModeEnabled?: boolean;` add:

```ts
  /** When true, this turn is an Arcade prototype generation turn. */
  arcadeMode?: boolean;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run product-native:typecheck` (or the repo's typecheck target).
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add libs/electron/shared/data-models/src/types.ts
git commit -m "feat(computer-agent): add arcadeMode to run request"
```

### Task 3.2: Detect `@Arcade` mention in the composer send path

**Files:**
- Modify: `libs/computer/shared/agent-chat-context/src/use-start-agent-chat.ts:~131-146`
- Test: colocated `use-start-agent-chat.spec.ts` (create if absent, mirroring the nearest existing context test)

- [ ] **Step 1: Write the failing test for mention detection**

Extract the parse into a pure helper so it's unit-testable:

```ts
// detectArcadeMention.spec.ts (same dir)
import { detectArcadeMention } from './detect-arcade-mention';

describe('detectArcadeMention', () => {
  it('detects @Arcade and strips it', () => {
    expect(detectArcadeMention('@Arcade a settings page')).toEqual({ arcadeMode: true, cleaned: 'a settings page' });
  });
  it('detects @Prototype as an alias', () => {
    expect(detectArcadeMention('@Prototype a dashboard')).toEqual({ arcadeMode: true, cleaned: 'a dashboard' });
  });
  it('passes normal prompts through untouched', () => {
    expect(detectArcadeMention('summarize this ticket')).toEqual({ arcadeMode: false, cleaned: 'summarize this ticket' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec jest libs/computer/shared/agent-chat-context/src/detect-arcade-mention.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// libs/computer/shared/agent-chat-context/src/detect-arcade-mention.ts
const ARCADE_MENTION = /(^|\s)@(Arcade|Prototype)\b/i;

// Mirror of Studio's @Computer routing: an @Arcade / @Prototype mention
// anywhere in the prompt routes the turn to the arcade generator. The mention
// is stripped before the prompt reaches the agent.
export function detectArcadeMention(message: string): { arcadeMode: boolean; cleaned: string } {
  if (!ARCADE_MENTION.test(message)) return { arcadeMode: false, cleaned: message };
  const cleaned = message.replace(ARCADE_MENTION, '$1').replace(/\s{2,}/g, ' ').trim();
  return { arcadeMode: true, cleaned };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec jest libs/computer/shared/agent-chat-context/src/detect-arcade-mention.spec.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the send path**

In `use-start-agent-chat.ts`, where the comment body + run request are built (~line 131–146), import `detectArcadeMention`, apply it to the user message, post the CLEANED text as the timeline comment body, and pass `arcadeMode` into the `runComputerAgent` request:

```ts
import { detectArcadeMention } from './detect-arcade-mention';
// ...
const { arcadeMode, cleaned } = detectArcadeMention(message);
// use `cleaned` where `message` was used for the comment body, and add to the run request:
window.DevRevNative.runComputerAgent({
  // ...existing fields, using `cleaned` for commentBody...
  arcadeMode,
});
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm exec nx run product-native:typecheck`
```bash
git add libs/computer/shared/agent-chat-context/src/detect-arcade-mention.ts libs/computer/shared/agent-chat-context/src/detect-arcade-mention.spec.ts libs/computer/shared/agent-chat-context/src/use-start-agent-chat.ts
git commit -m "feat(computer-agent): route @Arcade mention to arcade mode"
```

### Task 3.3: Thread `arcadeMode` through the IPC handler into the session

**Files:**
- Modify: `apps/product-native/src/app/events/ipc/register-computer-agent-handlers.ts:92-150`

- [ ] **Step 1: Pass `arcadeMode` to the module's session start.**

The handler already forwards `request` to `getModule().startSession(...)`. Confirm `arcadeMode` rides along on `request` (it's now typed). If `startSession` does not forward arbitrary request fields to the runner config, capture `request.arcadeMode` here and stash it so the module's config builder (Task 4) can read the active turn's mode. Minimal approach: store the latest `arcadeMode` per `chatId` on the module instance right before `startSession`:

```ts
// before: await getModule().startSession(request, auth, cb)
getModule().setArcadeModeForChat(request.chatId, !!request.arcadeMode);
await getModule().startSession(request, { getToken: () => App.getAccessToken(), endpoint }, (cb) =>
  sendToRenderer(cb, activeSender),
);
```

(`setArcadeModeForChat` is added in Task 4.1.)

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run product-native:typecheck`
Expected: passes once Task 4.1's method exists; if running this task first, expect one error about the missing method — proceed to Task 4 then re-run.

- [ ] **Step 3: Commit** (after Task 4.1 lands, to keep typecheck green)

```bash
git add apps/product-native/src/app/events/ipc/register-computer-agent-handlers.ts
git commit -m "feat(computer-agent): forward arcadeMode into session start"
```

---

## Phase 4 — Wire the instruction provider + flag into the runner (repo B)

### Task 4.1: Register the arcade `systemPromptSections` provider, gated by flag + per-chat mode

**Files:**
- Modify: `apps/product-native/src/app/modules/computer-agent/computer-agent-module.ts` (config build ~line 120; add a per-chat arcade-mode map + setter)
- Test: `computer-agent-module.arcade.spec.ts` (new, colocated)

- [ ] **Step 1: Add the per-chat mode map + setter to the class**

Near the other private fields:

```ts
  private arcadeModeByChat = new Map<string, boolean>();

  public setArcadeModeForChat(chatId: string, on: boolean): void {
    this.arcadeModeByChat.set(chatId, on);
  }
```

- [ ] **Step 2: Add the env-configurable sidecar URL + make-interactive script path**

Near the top constants:

```ts
const ARCADE_SIDECAR_URL = process.env.ARCADE_SIDECAR_URL || 'http://127.0.0.1:7799';

// Absolute path to the make-page-interactive converter in the agent's skills dir.
// The skill is a sibling of every other agent skill; the runner already knows the
// skills root (same dir the arcade skill is resolved from). Env override lets
// colleagues point at a local checkout during the dev-branch phase.
const ARCADE_MAKE_INTERACTIVE_SCRIPT =
  process.env.ARCADE_MAKE_INTERACTIVE_SCRIPT ||
  `${agentSkillsDir}/make-page-interactive/make-interactive.mjs`;

// Optional: the ui-publisher skill enables "share this prototype" (a DevRev
// article + link). Resolve its script only if the skill is installed; pass
// undefined otherwise so the publish block is omitted from the prompt entirely.
// Env override supports the dev-branch phase.
import fs from 'node:fs';
const arcadePublisherCandidate =
  process.env.ARCADE_PUBLISHER_SCRIPT || `${agentSkillsDir}/ui-publisher/scripts/publisher.py`;
const ARCADE_PUBLISHER_SCRIPT = fs.existsSync(arcadePublisherCandidate)
  ? arcadePublisherCandidate
  : undefined;
```

`agentSkillsDir` is the resolved per-identity skills directory (e.g.
`~/.devrev/computer/<identity>/agent/skills`) — use whatever constant the module
already has for locating agent skills. If none exists, derive it the same way the
arcade skill itself is located. The path must be absolute so the agent's Bash tool
runs it regardless of working directory. The `ui-publisher` skill is independent of
arcade mode — the prototype workflow works without it; only the share step is gated
on its presence.

- [ ] **Step 3: Register the provider in the `AgentRunnerConfig`**

In the `config: AgentRunnerConfig = { ... }` object (~line 120), add a `systemPromptSections` entry. It reads the feature flag and the per-chat mode (via the section context's `chatId`):

```ts
import { buildArcadeSystemSection } from './arcade/arcadeInstructions';
// ...
const config: AgentRunnerConfig = {
  ...readComputerNxtFeatureFlags(),
  systemPromptSections: [
    (ctx) =>
      buildArcadeSystemSection({
        enabled:
          !!App.getFeatureFlag(FEATURE_FLAG.COMPUTER_NXT_ARCADE_PROTOTYPE_ENABLED) &&
          this.arcadeModeByChat.get(ctx.chatId) === true,
        sidecarUrl: ARCADE_SIDECAR_URL,
        makeInteractiveScript: ARCADE_MAKE_INTERACTIVE_SCRIPT,
        publisherScript: ARCADE_PUBLISHER_SCRIPT,
      }),
  ],
  // ...rest unchanged (spawnClaudeCodeProcess, tracing, logging, etc.)
};
```

If `FEATURE_FLAG.COMPUTER_NXT_ARCADE_PROTOTYPE_ENABLED` does not exist yet, add it to the `FEATURE_FLAG` enum/const (search the codebase for `COMPUTER_NXT_COMPUTER_USE_ENABLED` and add the new key beside it, mapping to a flag name like `'computer_nxt_arcade_prototype_enabled'`). For local testing the flag can be force-enabled via the same mechanism colleagues use to toggle other `COMPUTER_NXT_*` flags (document in the test-setup note, Phase 5).

- [ ] **Step 4: Write the test**

```ts
// computer-agent-module.arcade.spec.ts
import { buildArcadeSystemSection } from './arcade/arcadeInstructions';

describe('arcade section gating', () => {
  const script = '/skills/make-page-interactive/make-interactive.mjs';
  it('is empty unless both flag and per-chat mode are on', () => {
    // flag on, mode off
    expect(buildArcadeSystemSection({ enabled: false, sidecarUrl: 'x', makeInteractiveScript: script })).toBe('');
    // both on
    expect(buildArcadeSystemSection({ enabled: true, sidecarUrl: 'http://127.0.0.1:7799', makeInteractiveScript: script })).toContain('/pack');
  });
});
```

(The provider closure's flag×mode AND-logic is covered by `arcadeInstructions` returning `''` when `enabled` is false; this test locks the contract.)

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm exec jest apps/product-native/src/app/modules/computer-agent/computer-agent-module.arcade.spec.ts`
Run: `pnpm exec nx run product-native:typecheck`
Expected: PASS, no type errors (this also greens Task 3.3).

- [ ] **Step 6: Commit**

```bash
git add apps/product-native/src/app/modules/computer-agent/computer-agent-module.ts apps/product-native/src/app/modules/computer-agent/computer-agent-module.arcade.spec.ts
git commit -m "feat(computer-agent): inject arcade section behind flag + per-chat mode"
```

---

## Phase 5 — End-to-end validation on the desktop dev build

### Task 5.1: Manual E2E — generate a prototype in Computer

**Files:** none (manual). Document results in `apps/product-native/docs/arcade-integration-smoke.md` (create).

- [ ] **Step 1: Start the sidecar** (repo A)

Run: `cd /Users/andrey.sundiev/arcade-prototyper && pnpm run sidecar -- --port 7799`
Expected: `[arcade-sidecar] listening on http://127.0.0.1:7799`.
Confirm Bedrock/arcade env is set as in Studio (the sidecar reuses `buildFrameBundle`, which fetches fonts at bundle time; no model creds needed for packing).

- [ ] **Step 2: Start desktop Computer dev build** (repo B) with the flag enabled

Run the product-native dev build the way the team runs it locally (see `apps/product-native` README / `nx run product-native:serve` or the documented dev command). Ensure `ARCADE_SIDECAR_URL` is unset (defaults to `127.0.0.1:7799`) and `COMPUTER_NXT_ARCADE_PROTOTYPE_ENABLED` is on.

- [ ] **Step 3: In a Computer chat, send:**

`@Arcade a settings page for notification preferences: a page titled Notifications with Email and Push cards, each with a few labelled toggle rows.`

Expected: the agent narrates in design language, a `prototype.html` artifact chip appears, and clicking it renders a full-fidelity arcade settings page on the canvas (matching the `liveLoop` PoC screenshot) **with a slim Annotate ⇄ View bar across the top, defaulting to View**. This confirms the make-interactive step (Task 2.1, step 4) ran and the canvas auto-refreshed the overwritten file on turn-complete.

- [ ] **Step 3b: Confirm the comment layer is usable in Computer's sandbox.**

The canvas iframe runs with `sandbox="allow-scripts"` only (no `allow-forms`). The make-page-interactive composer is a script-driven `<textarea>` (commits on Enter, not HTML form submit), so it should work under script-only. Verify: click **Annotate**, click an element, type a comment, press Enter — the pin + comment must persist. If typing/commit silently fails, the sandbox needs `allow-forms` added in `html-artifact-renderer.tsx` (a devrev-web change + security review) — record it as a follow-up, do not loosen the sandbox ad hoc.

- [ ] **Step 3c: (Only if the `ui-publisher` skill is installed) test opt-in sharing.**

Prereqs: `ui-publisher` cloned into the agent skills dir, and `DEVREV_TOKEN` exported in the Computer process env. In the same chat after a prototype is on canvas, send: `share this prototype with me only`. Expected: the agent asks/confirms `personal` access, runs `publisher.py --file prototype.html --access personal`, and replies with a clickable markdown link (not a raw URL). Open the link in the artifact viewer; confirm it renders the prototype WITH the Annotate/View bar (proves the published file is the interactive one and ui-publisher hosts it verbatim, no re-flatten). Then send `make it public` and confirm a 7-day link with an expiry is returned. If `ui-publisher` is NOT installed, instead confirm the agent has no publish block: ask `share this` and it should say it can't publish (rather than inventing a command). 

- [ ] **Step 4: Send a normal (non-`@Arcade`) prompt** and confirm Computer behaves exactly as before (no arcade section, no sidecar call). This guards the gating.

- [ ] **Step 5: Record outcomes** (screenshots, any failures) in the smoke doc and commit it.

```bash
git add apps/product-native/docs/arcade-integration-smoke.md
git commit -m "docs(computer-agent): arcade integration smoke results"
```

### Task 5.2: Share with colleagues (dev branch)

- [ ] **Step 1: Push both branches**

```bash
cd /Users/andrey.sundiev/arcade-prototyper && git push -u origin <arcade-sidecar-branch>
cd /Users/andrey.sundiev/devrev-web && git push -u origin <computer-arcade-branch>
```

- [ ] **Step 2: Write a one-page runbook** for colleagues: clone/pull both branches, `pnpm install` in each, `pnpm run sidecar` in arcade-prototyper, run the desktop Computer dev build with the flag on, then type `@Arcade <prompt>`. Save as `apps/product-native/docs/arcade-integration-runbook.md`. Commit.

---

## Out of scope (YAGNI — explicitly NOT doing now)

- **Vendoring the packer + kit into devrev-web** (the eventual production state). Blocked on devrev-web being Tailwind v3; the sidecar is the interim bridge per product decision.
- **Web Computer support** — only desktop has the canvas; web is later.
- **Auto-repair loop** (runtime error → new turn). Studio has it; not needed to prove the integration.
- **Figma ingest, target editing, share-to-web** — standalone Studio keeps these; the Computer version is intentionally leaner.
- **Packaging the sidecar into the Electron app** — dev-branch delivery runs it as a separate local process. Native packaging stays open but unbuilt.
- **Multiplayer / spectator** arcade frames.
- **True inline click-and-type editing** of a prototype on the canvas. The comment layer ships now; the loop is comment → regenerate. Direct editing is hard here because prototypes are live React (DOM edits don't survive re-render) and the sandbox can't write back to the `.tsx` source — a later exploration, not this plan.

## Open questions (resolve during execution, don't block)

1. Exact local dev command + flag-toggle mechanism for `apps/product-native` (Task 5.2 documents once confirmed).
2. Whether `vite-node` or `tsx` is the cleaner sidecar runner in this repo (Task 1.3 picks empirically).
3. If Phase 0.2 fails: wire `artifactViewer.openArtifact(...)` programmatically (fallback noted in Task 0.2).
4. How the runner resolves the agent skills dir for `ARCADE_MAKE_INTERACTIVE_SCRIPT` (Task 4.1, Step 2) — reuse the existing skills-root constant if one exists, else derive it the way the arcade skill is located. Env override (`ARCADE_MAKE_INTERACTIVE_SCRIPT`) covers the dev-branch phase regardless.
5. Whether Computer's canvas sandbox (`allow-scripts` only) lets the comment composer commit. Code read says yes (script-driven textarea, no form submit); Task 5.1 Step 3b confirms live. If not, adding `allow-forms` is a separate devrev-web change + security review.
6. How `DEVREV_TOKEN` reaches the publisher when the user shares (Task 2.1 publish block / Task 5.1 Step 3c). ui-publisher reads it from env; confirm the Computer agent's Bash environment has a DevRev PAT, or whether `pat-manager` (also a Ribhu skill) should be the supported fallback. Sharing is opt-in, so this never blocks the core generate→comment loop.
7. Whether `ui-publisher`'s artifact viewer (`devrev-artifact-viewer.vercel.app`) renders our interactive `prototype.html` (React-on-`#root` + annotate bar) byte-for-byte. Reading the skill says it hosts the file verbatim and renders `original_url`; Task 5.1 Step 3c confirms live. If the viewer sandboxes more tightly than Computer's own canvas, comments may view-only there — acceptable (the canvas remains the authoring surface), but note it.
```
