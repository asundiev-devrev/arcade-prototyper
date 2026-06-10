# Figma Export — One-Click via the Desktop Bridge — design

**Date:** 2026-06-10
**Status:** Design approved. Promotes the Figma export from a copy-a-prompt PoC (0.31.0) to a real one-click feature.
**Author:** Andrey + Claude (brainstorming session)
**Parent specs:** `2026-06-09-figma-export-hybrid-design.md`, `2026-06-09-figma-export-icon-capture-design.md`

## Why this exists

The shipped "Export to Figma" button copies a prompt the user pastes into a Claude session that has the figma-console Bridge connected. That's a PoC — nobody will paste a wall of text to export. This makes it **one click**: in Studio, click Export, the frame appears in Figma as real components. No prompt, no Claude session.

## The constraint and the chosen mechanism

Writing component instances into Figma requires the **Figma plugin API** (`createInstance`, `swapComponent`, …) — the REST API cannot create nodes. So *something inside Figma* must run the build. All prior successful runs went: figma-console MCP → the **"Figma Desktop Bridge"** plugin (id `figma-desktop-bridge-mcp`, third-party, southleft) → Figma.

**Decision: reuse the Bridge now; build our own plugin later.** The Bridge is a WS *client* that scans `ws://localhost:9223–9232`, connects, and accepts JSON-RPC-ish frames. We make **Studio impersonate the MCP server**: Studio opens a WS server on one of those ports, the Bridge connects, Studio sends an `EXECUTE_CODE` frame carrying our build script, the plugin `eval`s it in the Figma sandbox and replies. Studio already depends on `ws` and is already a localhost server — no plugin to write.

Accepted tradeoffs: the tester installs + runs the public Bridge plugin once; it's a third-party arbitrary-code-exec plugin (fine for an internal beta, replaced by our own plugin in a later iteration).

### The Bridge wire protocol (verified from the plugin source, 2026-06-10)

- The plugin is the **WS client**. It scans ports 9223–9232 and connects to any open WS server.
- On connect, the server MAY send `{ type: "SERVER_HELLO", data: { port, pid, serverVersion } }` (identity; the plugin logs it).
- The server drives work by sending `{ id: <string>, method: <string>, params: <object> }`.
- The plugin replies `{ id, result }` on success or `{ id, error: <message> }` on failure. Unknown method → `{ id, error: "Unknown method: …" }`.
- The method we use is **`EXECUTE_CODE`** with `params: { code: <js string>, timeout: <ms> }`. The plugin wraps `code` in an async IIFE and `eval`s it with the `figma` global in scope; the IIFE's returned value comes back as `result`. (Max timeout 30s, per the sandbox.)

This is exactly what the MCP's `figma_execute` uses under the hood — so our proven live scripts run unchanged through this channel.

## The simplification this unlocks

Everything in `captureTree` / `geometryMatch` / `swapPlan` / `executeSwap` / `runSwap` existed to **reconcile our component manifest against an external HTML→Figma converter's flat capture**. The Bridge path needs none of it: we control the script we send AND we have the **full SLJ with real geometry**. The script builds the layout directly from the SLJ — frames (auto-layout from `Layout`) + real 0.3 instances at their boxes — the same shape the original "all-ours" executor produced, which we already proved live (51 instances, 0 failures). No converter, no capture, no geometry matching.

**Reused unchanged:** `componentMap`, `iconMap`, `tokenMap`, `componentEntries`, `iconEntries`, and the SLJ producer `exportFrameToSlj` (fiber walk).

**Unused by this path (kept for now, retire-or-keep decided at the end):** `captureTree`, `geometryMatch`, `swapPlan`, `executeSwap`, `runSwap`, `wrapFigmaExportPrompt`.

## Architecture

```
[Studio :5556]  user clicks "Export to Figma" in ShareModal
   │  POST /api/projects/:slug/export/:frame/to-figma
   │  1. load the frame's stored SLJ (SLJ.json)
   │  2. buildExecuteScript(slj, maps) → self-contained JS string
   │  3. wsServer.runCode(script, timeout)
   ▼
[WS server on 9223–9232]  ← Bridge plugin connects as client (tester ran it once)
   │  4. send { id, method:"EXECUTE_CODE", params:{ code, timeout } }
   ▼
[Figma Desktop Bridge plugin]  eval's the script in the Figma sandbox
   │  5. builds frames + real 0.3 instances from the SLJ
   ▼  6. replies { id, result: { made, failures } }
[Studio]  middleware returns { ok, summary } → ShareModal shows Done / actionable error
```

## Units

### 1. `studio/server/figmaBridge/wsServer.ts` (new — pure transport)
Owns the WS server lifecycle and the request/response correlation. Knows nothing about Figma or SLJ.

```ts
export interface BridgeServer {
  /** The port we bound, or null if none free in 9223–9232. */
  port: number | null;
  /** True once a Bridge plugin client has connected. */
  isConnected(): boolean;
  /** Send an EXECUTE_CODE frame, resolve with the plugin's result or reject
   *  (timeout / plugin error / no client). */
  runCode(code: string, timeoutMs: number): Promise<unknown>;
  close(): Promise<void>;
}

/** Open a WS server on the first free port in 9223–9232. On client connect,
 *  send SERVER_HELLO. Correlates replies by `id`. A single live client is
 *  enough; if several connect, the most recent wins. */
export async function startBridgeServer(opts?: { hello?: { serverVersion: string } }): Promise<BridgeServer>;
```

Implementation notes: monotonic `id` counter; a `Map<id, {resolve,reject,timer}>`; on message, parse JSON, match `id`, settle. `runCode` rejects immediately with a typed reason when `!isConnected()`. Uses the existing `ws` dependency. The server is started lazily by the middleware (per export) and closed after, OR held as a singleton — see the middleware unit.

### 2. `studio/src/export/figma/buildExecuteScript.ts` (new — pure)
The heart. `buildExecuteScript(slj, maps): string` returns the JS the plugin runs.

```ts
export interface ExecuteScriptMaps {
  findComponentMapping: (name: string) => FigmaComponentMapping | null;
  findIconSetKey: (arcadeGenIconName: string) => string | null;
  tokenNameToVariableKey: (cssTokenName: string) => string | null;
}
export function buildExecuteScript(slj: SljDocument, maps: ExecuteScriptMaps): string;
```

It resolves the SLJ into a compact plan (component-set keys, variants, text, icon keys, token keys, boxes, layout) on the **Studio side** (pure, testable), then emits a script that embeds that plan + a fixed runtime. The runtime, inside Figma:
- creates a root frame; walks the plan;
- `ElementNode` → `figma.createFrame()`, apply `Layout` (auto-layout mode/gap/padding/align) or absolute position from `box`;
- `ComponentNode` → resolve the component-set key to a **local node** (`importComponentByKeyAsync` is attempted but falls back to local-node lookup — library drift makes key-import unreliable), pick the variant child, `createInstance()`, position/size from `box`, set label via the component's TEXT property (match by base name before `#`), swap the icon child to a local `Icons/*` Size-matched variant, bind token fills via `importVariableByKeyAsync` + `setBoundVariableForPaint`;
- best-effort per op (instance-before-remove; icon/token failure never aborts the node);
- returns `{ made: { frames, instances, icons, binds }, failures: [...] }`.

Because the runtime is a fixed string and only the embedded plan varies, the **plan-builder is the unit under test**; the runtime is exercised by the live run.

**Codifies the proven hand-written `figma_execute` scripts** from the hybrid + icon live runs (local-node instancing, variant maps, `Item name#…` label, icon `swapComponent`, token binding). Component-set-key → local-node-id resolution: the script resolves by searching the current file for a published node with the key, falling back to a name lookup; the Studio side passes the `setName` so the runtime can name-match when key-import fails.

### 3. `studio/server/middleware/figmaExport.ts` (new)
`POST /api/projects/:slug/export/:frame/to-figma`. Route mirrors `export.ts`’s regex style.
- Load `SLJ.json` for the frame (404 if absent — "export the frame first" — though in practice the click triggers a fresh SLJ; see ShareModal note).
- `buildExecuteScript(slj, maps)` with the real maps (`findComponentMapping`, `findIconMapping(n)?.figma?.componentSetKey ?? null`, `buildTokenMap(figma-variables.json#variables).tokenNameToVariableKey`).
- Ensure a `BridgeServer` is running (lazy singleton). If no client connected within a short window (~3s), return `{ error: { code: "no_bridge" } }`.
- `runCode(script, 30000)`; map the result to `{ ok: true, summary }`; on reject, return typed errors: `no_bridge`, `exec_error` (with message), `timeout`.

### 4. `studio/src/components/shell/ShareModal.tsx` (change)
"Export to Figma" button: instead of copying a prompt, `POST` the new endpoint.
- States: idle → "Exporting…" (disabled) → "Opened in Figma ✓" (2s) or an inline actionable error.
- Errors map to copy: `no_bridge` → "Open the Arcade export plugin in Figma, then try again."; `exec_error`/`timeout` → the message + "Check Figma is on the Arcade UI Kit library."
- Telemetry: replace the click-only `figma_export_copied` with `figma_export_run` carrying `{ outcome: "ok" | "no_bridge" | "error", instance_count?, failure_count? }`. (Register in `events.ts` union + `EVENT_NAMES`.)

**SLJ freshness:** the SLJ producer (`exportFrameToSlj`) runs in the frame iframe (it reads the live React tree). The middleware reads the stored `SLJ.json`. So the button must first trigger a fresh serialize (the frame is open in the viewport) → POST saves SLJ → then call to-figma. ShareModal already has the frame list; the export click sequences: (a) ask the viewport to serialize the selected frame to SLJ (existing path), (b) POST to-figma. If (a) isn't readily available for a non-active frame, v1 scopes Export-to-Figma to the **currently-open frame** and reads its just-saved SLJ. (Detail to confirm in the plan: how ShareModal triggers a serialize for the selected frame.)

## Error handling

Every failure is typed and surfaced — never a silent "done":
- `no_bridge` — no plugin client connected. Actionable copy.
- `exec_error` — the script threw (caught at the `EXECUTE_CODE` boundary); message surfaced.
- `timeout` — plugin didn't reply in 30s.
- Partial success — the script's `made`/`failures` come back; modal says "Exported, N items need attention" rather than claiming full success.
The in-Figma runtime stays best-effort per node (proven: instance-before-remove, icon/token failures isolated).

## Testing

- **`buildExecuteScript` (pure):** fixture SLJ → assert the emitted script embeds the right plan — component-set keys + variants for each ComponentNode, icon set-keys for icon-bearing ones, token keys, every node represented, no node dropped. Assert it's syntactically a single self-contained expression (no external refs).
- **`wsServer`:** fake WS client connects → assert `runCode` sends `{id,method:"EXECUTE_CODE",params}` and resolves on matching `{id,result}`; rejects on `{id,error}`, on timeout, and immediately when no client.
- **`figmaExport` middleware:** stored SLJ + fake `BridgeServer` → `{ok,summary}` on success; `no_bridge` when not connected; `exec_error` on reject.
- **ShareModal:** Export click hits the endpoint (mocked) → Exporting → Done / typed-error states; fires `figma_export_run` with outcome.
- **Live run:** Studio + Bridge plugin on the 0.3 library → click Export on Computer-with-panel → real two-pane UI with real components appears; screenshot-verified.

## Scope

**In:** `wsServer`, `buildExecuteScript` (+ plan builder), `figmaExport` middleware + route registration in `vite.config.ts`, ShareModal wiring, `figma_export_run` telemetry, tests, one live screenshot-verified run.

**Out (explicit):**
- Building our own Figma plugin (next iteration — reuse the Bridge now).
- Re-curating the deprecated sidebar `Chat Item` row (#2, blocked on DS owner) — rows still export to the current mapped component.
- Token-binding fidelity polish, transcript-overflow cosmetics.
- Auto-installing/launching the plugin — tester runs it once (documented in the error copy + CHANGELOG).
- Retiring the unused reconciliation units — decided after the Bridge path works.

## Done =

In Studio, with Figma open + the Bridge plugin running on the Arcade UI Kit 0.3 library, clicking **Export to Figma** on the Computer-with-panel frame produces the real two-pane UI with real component instances in Figma — no prompt, no Claude session — within one `EXECUTE_CODE` round trip. Screenshot-verified. When Figma/plugin isn't ready, the modal says exactly what to do.

## Risks

- **Plugin not running / wrong file.** The dominant failure. Mitigation: typed `no_bridge` + actionable copy; short connect window so the button fails fast, not hangs.
- **30s `EXECUTE_CODE` cap.** The Computer frame ran in well under 30s live (52 instances). Larger frames could approach it. Mitigation: the script is one batched op set; if a frame ever exceeds, chunk in a follow-up (out of scope now).
- **Component-set key drift** (the deprecated nav page). Mitigation: runtime resolves by local node + name fallback, degrades per-node; the row still appears (to the mapped component), failures reported not hidden.
- **Port contention** with a real MCP instance also on 9223–9232. Mitigation: bind the first *free* port; the Bridge scans the whole range and connects to ours too. If both an MCP and Studio are up, the plugin connects to both — harmless (our export is a discrete request/response).
- **Third-party plugin dependency.** Accepted for the beta; the own-plugin iteration removes it.
