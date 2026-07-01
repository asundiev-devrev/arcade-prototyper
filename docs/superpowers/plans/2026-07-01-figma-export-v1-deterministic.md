# Figma Export v1 (Two-Tier Deterministic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild a selected Studio frame in Figma with deterministic fidelity — real Arcade components + bound color variables for mapped nodes, faithful rendering (incl. text styling) for everything else — via a real, shippable transport.

**Architecture:** Studio middleware serializes the live frame to SLJ, builds a Plugin-API script (`buildExecuteScript`, already on HEAD), and sends it over the existing `wsServer.ts` WebSocket to a **Figma bridge plugin we build in this plan** (the piece that was never built). Two deterministic tiers: Tier 1 (mapped components/tokens by key) + Tier 2 (faithful render from captured styles). No agent, no LLM in v1.

**Tech Stack:** TypeScript, Vite middleware, `ws`, Figma Plugin API (plugin manifest + `code.js`), Vitest.

## Global Constraints

- Package manager is **pnpm**; never `npm`/`yarn`. (repo CLAUDE.md)
- Tests: `pnpm run studio:test <path>` for one file; full suite before non-trivial commits.
- Commits: Conventional Commits, scope `studio/figma-export`. Never `git add -A`; stage explicit paths.
- Vite middleware does NOT hot-reload — a full `pnpm run studio` restart is required to pick up `server/**` changes when manually testing.
- Every bug/behavior gets a test (repo test discipline).
- Fonts: DevRev's Figma library already has all fonts; the runtime's `ensureFont` loads a node's own font before setting text. Do not hardcode font substitutions.
- Tier-1 token binding is **color-only** in v1 (verified: `bindFill` bails on non-COLOR). Spacing/radius/typography variable binding is explicitly OUT of v1.
- Transport is the **Studio ws-bridge + a Figma plugin** (this plan builds the plugin). The official `use_figma` MCP is NOT available to the packaged app and is not used.

---

## File Structure

- `studio/figma-plugin/manifest.json` — Figma plugin manifest (NEW). The bridge plugin users run in Figma Desktop.
- `studio/figma-plugin/code.js` — plugin main thread: connects to `ws://localhost:9223-9232`, handles `EXECUTE_CODE`, evals, replies (NEW).
- `studio/figma-plugin/ui.html` — minimal plugin UI hosting the WebSocket (Figma plugins can only open sockets from the UI iframe) (NEW).
- `studio/src/export/slj.ts` — extend `ElementStyle` text fields already exist; no type change needed (VERIFY only).
- `studio/src/export/fiberWalk.ts` — extend `elementStyle` + both text-leaf emissions to capture text color/size/weight/family/lineHeight (MODIFY `:29-38`, `:84-86`, `:101-102`).
- `studio/src/export/figma/buildExecuteScript.ts` — apply captured text styling + cornerRadius in the runtime (MODIFY the text branch + frame branch).
- `studio/src/export/figma/executePlan.ts` — carry text style + radius from SLJ into the plan (MODIFY `PlanText`, `walk`).
- `studio/server/middleware/figmaExport.ts` — already builds + sends the script; keep. Add DS-gap counting to the result (MODIFY).
- `studio/src/lib/telemetry/events.ts` — replace `figma_export_run` with started/succeeded/failed events (MODIFY).
- `studio/docs/figma-export-setup.md` — user doc: install + run the bridge plugin once (NEW).
- Tests under `studio/__tests__/export/` and `studio/__tests__/server/`.

---

## Task 1: Build the Figma bridge plugin (the transport)

**Files:**
- Create: `studio/figma-plugin/manifest.json`
- Create: `studio/figma-plugin/code.js`
- Create: `studio/figma-plugin/ui.html`
- Test: `studio/__tests__/figma-plugin/protocol.test.ts`

**Interfaces:**
- Consumes: Studio's `wsServer.ts` protocol (VERIFIED `wsServer.ts:44,68`): server→plugin `{type:"SERVER_HELLO",data}` on connect and `{id, method:"EXECUTE_CODE", params:{code,timeout}}` per run; plugin→server reply `{id, result}` or `{id, error}`.
- Produces: a runnable Figma plugin that evals `code` against the `figma` global and returns its value.

- [ ] **Step 1: Write the failing protocol test**

The plugin's reply-shaping logic is pure and testable without Figma. Extract it into `code.js` as a named function the test can import via a small shim. First, the test:

```ts
// studio/__tests__/figma-plugin/protocol.test.ts
import { describe, it, expect } from "vitest";
import { shapeReply } from "../../figma-plugin/replyShape.mjs";

describe("bridge plugin reply shaping", () => {
  it("wraps a successful result under the request id", () => {
    expect(shapeReply("7", { made: { instances: 3 } }, null))
      .toEqual({ id: "7", result: { made: { instances: 3 } } });
  });
  it("wraps an error message under the request id", () => {
    expect(shapeReply("7", null, new Error("boom")))
      .toEqual({ id: "7", error: "boom" });
  });
  it("ignores messages without EXECUTE_CODE method upstream (returns null shape)", () => {
    // shapeReply is only called for EXECUTE_CODE; guard is in code.js. Sanity:
    expect(shapeReply("1", undefined, null)).toEqual({ id: "1", result: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/figma-plugin/protocol.test.ts`
Expected: FAIL — cannot find `../../figma-plugin/replyShape.mjs`.

- [ ] **Step 3: Create the shared reply-shaping helper**

```js
// studio/figma-plugin/replyShape.mjs
// Pure helper shared by code.js (via inline copy) and the unit test.
export function shapeReply(id, result, error) {
  if (error) return { id: id, error: error && error.message ? error.message : String(error) };
  return { id: id, result: result };
}
```

- [ ] **Step 4: Create the plugin manifest**

```json
// studio/figma-plugin/manifest.json
{
  "name": "Arcade Studio Export Bridge",
  "id": "arcade-studio-export-bridge",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": ["http://localhost:9223","http://localhost:9224","http://localhost:9225","http://localhost:9226","http://localhost:9227","http://localhost:9228","http://localhost:9229","http://localhost:9230","http://localhost:9231","http://localhost:9232"]
  }
}
```

- [ ] **Step 5: Create the plugin main thread (`code.js`)**

The socket lives in the UI iframe (Figma plugins can only open WebSockets from UI). `code.js` relays: UI→main forwards `EXECUTE_CODE` codes to eval; main→UI sends replies back to the socket.

```js
// studio/figma-plugin/code.js
figma.showUI(__html__, { visible: true, width: 240, height: 120 });

// Reply shaping (mirror of replyShape.mjs — kept inline; Figma plugins can't import).
function shapeReply(id, result, error) {
  if (error) return { id: id, error: error && error.message ? error.message : String(error) };
  return { id: id, result: result };
}

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type !== "EXECUTE_CODE") return;
  var reply;
  try {
    // Figma sandbox forbids the AsyncFunction constructor; eval an async IIFE.
    var wrapped = "(async function(){\n" + msg.code + "\n})()";
    var out = await eval(wrapped);
    reply = shapeReply(msg.id, out, null);
  } catch (e) {
    reply = shapeReply(msg.id, null, e);
  }
  figma.ui.postMessage({ type: "REPLY", payload: reply });
};
```

- [ ] **Step 6: Create the plugin UI (`ui.html`) — the WebSocket host**

```html
<!-- studio/figma-plugin/ui.html -->
<!DOCTYPE html><html><body>
<div id="s" style="font:12px sans-serif;padding:8px">Connecting to Arcade Studio…</div>
<script>
var PORTS = [9223,9224,9225,9226,9227,9228,9229,9230,9231,9232];
var ws = null, statusEl = document.getElementById("s");
function setStatus(t){ statusEl.textContent = t; }
function tryPort(i){
  if (i >= PORTS.length) { setStatus("Studio not found. Is it running?"); setTimeout(function(){tryPort(0);}, 3000); return; }
  var sock = new WebSocket("ws://localhost:" + PORTS[i]);
  sock.onopen = function(){ ws = sock; setStatus("Connected to Arcade Studio ✓"); };
  sock.onclose = function(){ if (ws === sock) ws = null; tryPort(i+1); };
  sock.onerror = function(){ try{sock.close();}catch(e){} };
  sock.onmessage = function(ev){
    var msg; try { msg = JSON.parse(ev.data); } catch(e){ return; }
    if (msg.type === "SERVER_HELLO") return;
    if (msg.method === "EXECUTE_CODE") {
      parent.postMessage({ pluginMessage: { type: "EXECUTE_CODE", id: msg.id, code: msg.params.code } }, "*");
    }
  };
}
window.onmessage = function(ev){
  var pm = ev.data && ev.data.pluginMessage;
  if (pm && pm.type === "REPLY" && ws && ws.readyState === 1) ws.send(JSON.stringify(pm.payload));
};
tryPort(0);
</script>
</body></html>
```

- [ ] **Step 7: Run the protocol test to verify it passes**

Run: `pnpm run studio:test __tests__/figma-plugin/protocol.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add studio/figma-plugin/manifest.json studio/figma-plugin/code.js studio/figma-plugin/ui.html studio/figma-plugin/replyShape.mjs studio/__tests__/figma-plugin/protocol.test.ts
git commit -m "feat(studio/figma-export): add Figma bridge plugin for export transport"
```

**Manual gate (after Task 5, needs Figma Desktop):** Import `studio/figma-plugin/manifest.json` via Plugins → Development → Import plugin from manifest; Run it; confirm "Connected to Arcade Studio ✓" while `pnpm run studio` is up.

---

## Task 2: Capture text styling in the serializer (Tier-2 fidelity)

**Files:**
- Modify: `studio/src/export/fiberWalk.ts:29-38` (elementStyle), `:84-86` and `:101-102` (text leaves)
- Verify: `studio/src/export/slj.ts` (ElementStyle already has `fontFamily/fontSize/fontWeight/lineHeight/color` — VERIFIED, no change)
- Test: `studio/__tests__/export/fiberWalk-text-style.test.ts`

**Interfaces:**
- Consumes: `ctx.reader.style(f)` returns an object with `getPropertyValue(prop)` (VERIFIED `fiberWalk.ts:107`, used by `elementStyle`).
- Produces: text `SljNode`s whose `style` carries `characters` + `color`, `fontSize`, `fontWeight`, `fontFamily`, `lineHeight` when present.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/fiberWalk-text-style.test.ts
import { describe, it, expect } from "vitest";
import { walkFiber } from "../../src/export/fiberWalk";

// Minimal fake reader/ctx: a single text host node with a computed style.
function fakeStyle(map: Record<string,string>) {
  return { getPropertyValue: (p: string) => map[p] ?? "" };
}
function makeCtx(styleMap: Record<string,string>) {
  return {
    isSkippable: () => false,
    isComponent: () => null,
    iconNameFor: () => null,
    resolveColor: (v: string) => v,
    reader: {
      hostTag: () => "span",
      box: () => ({ x: 0, y: 0, width: 40, height: 16 }),
      text: () => "Hello",
      style: () => fakeStyle(styleMap),
      hostClassName: () => null,
    },
  } as any;
}

describe("fiberWalk captures text styling", () => {
  it("emits color/size/weight/family/lineHeight on a text leaf", () => {
    const fiber = { child: null, sibling: null, memoizedProps: {}, type: "span" } as any;
    const node: any = walkFiber(fiber, makeCtx({
      "color": "rgb(20, 22, 26)",
      "font-size": "13px",
      "font-weight": "500",
      "font-family": "Inter, sans-serif",
      "line-height": "20px",
    }));
    expect(node.tag).toBe("text");
    expect(node.style.characters).toBe("Hello");
    expect(node.style.color).toBe("rgb(20, 22, 26)");
    expect(node.style.fontSize).toBe(13);
    expect(node.style.fontWeight).toBe(500);
    expect(node.style.fontFamily).toContain("Inter");
    expect(node.style.lineHeight).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/fiberWalk-text-style.test.ts`
Expected: FAIL — `node.style.color` is undefined (text leaf currently only sets `characters`).

- [ ] **Step 3: Add a text-style reader helper in fiberWalk.ts**

Insert after `elementStyle` (`:38`):

```ts
// Capture computed text styling for a text leaf. Only sets fields that parse.
function textStyle(
  s: { getPropertyValue(p: string): string },
  resolveColor: (v: string) => string,
  characters: string,
): ElementStyle {
  const out: ElementStyle = { characters };
  const color = s.getPropertyValue("color");
  if (color) out.color = resolveColor(color);
  const size = parseFloat(s.getPropertyValue("font-size"));
  if (Number.isFinite(size) && size > 0) out.fontSize = size;
  const weight = parseFloat(s.getPropertyValue("font-weight"));
  if (Number.isFinite(weight) && weight > 0) out.fontWeight = weight;
  const family = s.getPropertyValue("font-family");
  if (family) out.fontFamily = family;
  const lh = parseFloat(s.getPropertyValue("line-height"));
  if (Number.isFinite(lh) && lh > 0) out.lineHeight = lh;
  return out;
}
```

- [ ] **Step 4: Use it at the standalone text leaf (`:101-102`)**

Replace:

```ts
    if (text && kids.length === 0) {
      return { kind: "element", tag: "text", box, layout: null, style: { characters: text }, children: [] };
    }
```

with:

```ts
    if (text && kids.length === 0) {
      return { kind: "element", tag: "text", box, layout: null, style: textStyle(ctx.reader.style(f), ctx.resolveColor, text), children: [] };
    }
```

- [ ] **Step 5: Use it at the pruned-component text child (`:84-86`)**

Replace:

```ts
        const children: SljNode[] = text
          ? [{ kind: "element", tag: "text", box, layout: null, style: { characters: text }, children: [] }]
          : [];
```

with:

```ts
        const children: SljNode[] = text
          ? [{ kind: "element", tag: "text", box, layout: null, style: textStyle(ctx.reader.style(f), ctx.resolveColor, text), children: [] }]
          : [];
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/fiberWalk-text-style.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the existing fiberWalk suite for regressions**

Run: `pnpm run studio:test __tests__/export/fiberWalk.test.ts`
Expected: PASS (no regressions; existing tests only assert `characters`).

- [ ] **Step 8: Commit**

```bash
git add studio/src/export/fiberWalk.ts studio/__tests__/export/fiberWalk-text-style.test.ts
git commit -m "feat(studio/figma-export): capture text color/size/weight/family in SLJ"
```

---

## Task 3: Carry text style + radius into the execute plan

**Files:**
- Modify: `studio/src/export/figma/executePlan.ts` (`PlanText` interface, `walk` text branch, frame branch)
- Test: `studio/__tests__/export/executePlan-textstyle.test.ts`

**Interfaces:**
- Consumes: text `SljNode.style` fields from Task 2.
- Produces: `PlanText` with optional `color`, `fontSize`, `fontWeight`, `fontFamily`, `lineHeight`; `PlanFrame` with optional `cornerRadius`. Field names below are the contract Task 4's runtime reads.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/executePlan-textstyle.test.ts
import { describe, it, expect } from "vitest";
import { sljToExecutePlan } from "../../src/export/figma/executePlan";

const MAPS = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

describe("executePlan carries text styling", () => {
  it("copies color/size/weight/family/lineHeight onto PlanText", () => {
    const slj: any = {
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: { kind: "element", tag: "text", box: { x: 0, y: 0, width: 40, height: 16 },
        layout: null, children: [],
        style: { characters: "Hi", color: "#141a1a", fontSize: 13, fontWeight: 500, fontFamily: "Inter", lineHeight: 20 } },
    };
    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root).toMatchObject({
      kind: "text", characters: "Hi", fillColor: "#141a1a",
      fontSize: 13, fontWeight: 500, fontFamily: "Inter", lineHeight: 20,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/executePlan-textstyle.test.ts`
Expected: FAIL — `plan.root` has no `fontSize` (current `PlanText` drops styling).

- [ ] **Step 3: Extend the `PlanText` interface**

In `executePlan.ts`, replace the `PlanText` interface:

```ts
export interface PlanText {
  kind: "text";
  box: Box;
  characters: string;
  fillVariableKey?: string;
  fillColor?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number;
}
```

- [ ] **Step 4: Populate the fields in the text branch**

The current text branch (`executePlan.ts:97-99`) reads:

```ts
    if (el.tag === "text" && el.style.characters !== undefined) {
      return { kind: "text", box: el.box, characters: el.style.characters, ...fillFields(maps, el.style.color) };
    }
```

Replace with:

```ts
    if (el.tag === "text" && el.style.characters !== undefined) {
      return {
        kind: "text",
        box: el.box,
        characters: el.style.characters,
        ...fillFields(maps, el.style.color),
        ...(el.style.fontSize !== undefined ? { fontSize: el.style.fontSize } : {}),
        ...(el.style.fontWeight !== undefined ? { fontWeight: el.style.fontWeight } : {}),
        ...(el.style.fontFamily !== undefined ? { fontFamily: el.style.fontFamily } : {}),
        ...(el.style.lineHeight !== undefined ? { lineHeight: el.style.lineHeight } : {}),
      };
    }
```

- [ ] **Step 5: Add cornerRadius to PlanFrame + populate it**

Add `cornerRadius?: number;` to the `PlanFrame` interface. In the element frame branch (`executePlan.ts:100`), add radius passthrough:

```ts
    return {
      kind: "frame",
      box: el.box,
      layout: el.layout,
      ...fillFields(maps, el.style.fill),
      ...(el.style.cornerRadius !== undefined ? { cornerRadius: el.style.cornerRadius } : {}),
      children: el.children.map(walk),
    };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/executePlan-textstyle.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/src/export/figma/executePlan.ts studio/__tests__/export/executePlan-textstyle.test.ts
git commit -m "feat(studio/figma-export): carry text styling + radius into execute plan"
```

---

## Task 4: Apply text styling + radius in the runtime

**Files:**
- Modify: `studio/src/export/figma/buildExecuteScript.ts` (text branch ~`:141-149`, frame branch ~`:151-160`, `ensureFont` ~`:46-50`)
- Test: `studio/__tests__/export/figma/buildExecuteScript.test.ts` (extend existing — note the `figma/` subdir and `../../../` import depth)

**Interfaces:**
- Consumes: `PlanText.{fontSize,fontWeight,fontFamily,lineHeight,fillColor}`, `PlanFrame.cornerRadius` from Task 3.
- Produces: runtime JS that sets created text nodes' font/size/color and frames' cornerRadius. (No new exported symbol; asserted via the emitted script string.)

- [ ] **Step 1: Write the failing test**

The runtime is embedded as a string constant; assert the emitted script contains the styling calls for a styled-text plan. Add to the EXISTING test file at `studio/__tests__/export/figma/buildExecuteScript.test.ts` (already imports `buildExecuteScript` via `../../../src/...`); reuse its imports — do NOT add a new import line.

```ts
// add a new `it(...)` inside studio/__tests__/export/figma/buildExecuteScript.test.ts
// (buildExecuteScript is already imported at the top of that file)

it("emits runtime that applies text fontSize/color and frame cornerRadius", () => {
  const slj: any = {
    frame: { slug: "f", project: "p", width: 100, mode: "light" },
    root: { kind: "element", tag: "div", box: { x:0,y:0,width:100,height:40 }, layout: null,
      style: { fill: "#fff", cornerRadius: 8 },
      children: [{ kind: "element", tag: "text", box: {x:0,y:0,width:40,height:16},
        layout: null, children: [], style: { characters: "Hi", color: "#141a1a", fontSize: 13, fontWeight: 500, fontFamily: "Inter" } }] },
  };
  const MAPS = { findComponentMapping:()=>null, findIconSetKey:()=>null, findIconSetName:()=>null, tokenNameToVariableKey:()=>null };
  const script = buildExecuteScript(slj, MAPS as any);
  expect(script).toContain("fontSize");        // runtime references text.fontSize
  expect(script).toContain("cornerRadius");     // runtime applies frame radius
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/export/figma/buildExecuteScript.test.ts`
Expected: FAIL — current runtime never references `fontSize`/`cornerRadius`.

- [ ] **Step 3a: Change `ensureFont` to return the loaded font object (or null)**

`ensureFont` currently returns a boolean. Change it to return the loaded `{family,style}` on success, `null` on failure. This is the ONLY definition to use — the text branch below depends on it:

```js
async function ensureFont(fn) {
  var k = fn.family + "|" + fn.style;
  if (fonts[k]) return fonts[k];
  try { await figma.loadFontAsync(fn); fonts[k] = fn; return fn; } catch (e) { return null; }
}
```

`setLabel`'s existing call is `var okFont = await ensureFont(t.fontName); if (!okFont) return;` — this is a truthy check, so returning the object (truthy) or null (falsy) keeps it working unchanged. Leave `setLabel` as-is.

- [ ] **Step 3b: Replace the runtime text branch**

The text branch currently creates text, loads Inter Regular, sets `characters`, positions, and binds/sets fill. Replace it entirely with font-family/size-aware logic (single, non-contradictory version):

```js
  if (node.kind === "text") {
    var t = figma.createText();
    parent.appendChild(t);
    var fam = node.fontFamily ? String(node.fontFamily).split(",")[0].replace(/["']/g,"").trim() : "Inter";
    var wnum = node.fontWeight || 400;
    var style = wnum >= 650 ? "Bold" : (wnum >= 550 ? "Semi Bold" : (wnum >= 450 ? "Medium" : "Regular"));
    var loaded = await ensureFont({ family: fam, style: style });
    if (!loaded) loaded = await ensureFont({ family: "Inter", style: "Regular" });
    if (loaded) { try { t.fontName = loaded; } catch (e) {} }
    try { t.characters = node.characters; } catch (e) {}
    if (node.fontSize) { try { t.fontSize = node.fontSize; } catch (e) {} }
    t.x = node.box.x - ox; t.y = node.box.y - oy;
    if (node.fillVariableKey) { await bindFill(t, node.fillVariableKey); } else if (node.fillColor) { setSolid(t, node.fillColor); }
    return;
  }
```

Order matters: `t.fontName` (and thus the loaded font) must be set BEFORE `t.characters` and `t.fontSize`, which the block above does.

- [ ] **Step 4: Apply cornerRadius in the runtime frame branch**

In the frame branch, after `applyLayout(f, node.layout);` and before children, add:

```js
  if (node.cornerRadius) { try { f.cornerRadius = node.cornerRadius; } catch (e) {} }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/export/figma/buildExecuteScript.test.ts`
Expected: PASS (new + existing assertions).

- [ ] **Step 6: Commit**

```bash
git add studio/src/export/figma/buildExecuteScript.ts studio/__tests__/export/figma/buildExecuteScript.test.ts
git commit -m "feat(studio/figma-export): apply captured text styling + radius in runtime"
```

---

## Task 5: DS-gap counting + typed telemetry

**Files:**
- Modify: `studio/server/middleware/figmaExport.ts` (import `sljToExecutePlan` + `track`; count Tier-1 instances vs Tier-2 frames/text from the plan; fire telemetry)
- Modify: `studio/src/lib/telemetry/events.ts` (replace `figma_export_run` with 3 events)
- Modify: `studio/src/components/shell/ShareModal.tsx:108,117,122` (migrate the 3 `figma_export_run` call sites — deleting the event breaks these TypeScript call sites otherwise)
- Test: `studio/__tests__/server/figmaExport-gaps.test.ts`

**Interfaces:**
- Consumes: `sljToExecutePlan(slj, MAPS)` (from `../../src/export/figma/executePlan`) → `{ frame, root }`; the SLJ + MAPS already exist in `handleFigmaExport`.
- Produces: `countPlanNodes(node, acc?): { instances: number; frames: number; text: number }`; telemetry events `figma_export_started/succeeded/failed`.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/figmaExport-gaps.test.ts
import { describe, it, expect } from "vitest";
import { countPlanNodes } from "../../server/middleware/figmaExport";

describe("countPlanNodes", () => {
  it("counts instances (Tier 1) vs frames/text (Tier 2)", () => {
    const root: any = { kind: "frame", children: [
      { kind: "instance", children: [] },
      { kind: "text", },
      { kind: "frame", children: [{ kind: "instance", children: [] }] },
    ]};
    expect(countPlanNodes(root)).toEqual({ instances: 2, frames: 2, text: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/figmaExport-gaps.test.ts`
Expected: FAIL — `countPlanNodes` not exported.

- [ ] **Step 3: Add and export `countPlanNodes` in figmaExport.ts**

```ts
export function countPlanNodes(node: any, acc = { instances: 0, frames: 0, text: 0 }) {
  if (node.kind === "instance") acc.instances++;
  else if (node.kind === "text") acc.text++;
  else acc.frames++;
  for (const c of node.children ?? []) countPlanNodes(c, acc);
  return acc;
}
```

- [ ] **Step 4: Replace the telemetry event in events.ts**

Remove the `figma_export_run` union member and add:

```ts
  | { name: "figma_export_started"; props: { frame_count: number } }
  | { name: "figma_export_succeeded"; props: { ds_instances: number; pixel_nodes: number; duration_ms: number } }
  | { name: "figma_export_failed"; props: { error_kind: "no_bridge" | "timeout" | "build_error" | "other"; duration_ms: number } }
```

Update the `EVENT_NAMES` array accordingly (remove `figma_export_run`, add the three).

- [ ] **Step 5: Add imports + fire the events in the handler**

At the top of `figmaExport.ts`, add (mirroring `cloudflare.ts:11-12`):

```ts
import { sljToExecutePlan } from "../../src/export/figma/executePlan";
import { track } from "../../src/lib/telemetry/server";
```

In `handleFigmaExport`, after the SLJ is loaded and before `buildExecuteScript`, materialize the plan for counting and fire `started`:

```ts
  const startedAt = Date.now();
  track({ name: "figma_export_started", props: { frame_count: 1 } });
  const plan = sljToExecutePlan(slj, MAPS);
  const counts = countPlanNodes(plan.root);
```

On the success path (after `bridge.runCode(...)` resolves), fire:

```ts
  track({ name: "figma_export_succeeded", props: {
    ds_instances: counts.instances,
    pixel_nodes: counts.frames + counts.text,
    duration_ms: Date.now() - startedAt,
  } });
```

On each existing failure branch, map to an `error_kind` and fire before returning:
- the `no_bridge` branch → `error_kind: "no_bridge"`
- the timeout branch → `error_kind: "timeout"`
- the build/SLJ-load error branch → `error_kind: "build_error"`
- any other catch → `error_kind: "other"`

```ts
  track({ name: "figma_export_failed", props: { error_kind: "no_bridge", duration_ms: Date.now() - startedAt } });
```

(`MAPS` is the existing constant in this file; `slj` is the already-loaded document.)

- [ ] **Step 6: Migrate the ShareModal call sites (deleting the event breaks them)**

`ShareModal.tsx` fires `figma_export_run` at `:108` (ok), `:117` (error), `:122` (catch). Replace each so the renderer keeps compiling. Since v1's export is triggered server-side and the renderer only reflects outcome, map them to the new names:

```tsx
// :108 success path (was figma_export_run outcome:"ok")
track({ name: "figma_export_succeeded", props: { ds_instances: data.summary?.made?.instances ?? 0, pixel_nodes: 0, duration_ms: 0 } });
// :117 error path (was outcome:"no_bridge" | "error")
track({ name: "figma_export_failed", props: { error_kind: code === "no_bridge" ? "no_bridge" : "other", duration_ms: 0 } });
// :122 catch path (was outcome:"error")
track({ name: "figma_export_failed", props: { error_kind: "other", duration_ms: 0 } });
```

NOTE: the renderer lacks real durations/pixel counts (the server owns those, Step 5). Passing `0` here is acceptable — the server-side `succeeded/failed` events carry the authoritative numbers; the renderer events only mark that the user saw an outcome. If cleaner, DELETE the three renderer `track` calls entirely and rely solely on the server events — either is fine; pick deletion if `data.summary` isn't reliably shaped.

- [ ] **Step 7: Run tests**

Run: `pnpm run studio:test __tests__/server/figmaExport-gaps.test.ts __tests__/lib/telemetry/events.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck the renderer (catch the ShareModal migration)**

Run: `pnpm run studio:test __tests__/components/share-modal-cert-probe.test.tsx`
Expected: PASS (exercises ShareModal; fails to compile if a `figma_export_run` reference remains).

- [ ] **Step 9: Commit**

```bash
git add studio/server/middleware/figmaExport.ts studio/src/lib/telemetry/events.ts studio/src/components/shell/ShareModal.tsx studio/__tests__/server/figmaExport-gaps.test.ts
git commit -m "feat(studio/figma-export): DS-gap counts + typed export telemetry"
```

---

## Task 6: User setup doc + full-suite gate

**Files:**
- Create: `studio/docs/figma-export-setup.md`
- Test: full suite

- [ ] **Step 1: Write the setup doc**

```markdown
# Export to Figma — one-time setup

Export runs through a small Figma plugin that talks to Studio on your machine.

1. Open Figma Desktop and the file you want to export into.
2. Plugins → Development → Import plugin from manifest… → choose
   `studio/figma-plugin/manifest.json` (ships inside the app bundle).
3. Run **Arcade Studio Export Bridge**. It shows "Connected to Arcade Studio ✓".
4. In Studio, open a frame → Export to Figma. The frame rebuilds in Figma using
   real Arcade components where mapped, faithful layers everywhere else.

Keep the plugin running while you export. If it says "Studio not found", make
sure Studio is open, then it retries automatically.
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm run studio:test`
Expected: PASS (except the known-unrelated `figmaBridge/wsServer.test.ts` port-flake if still present — confirm it fails identically on a clean checkout before dismissing).

- [ ] **Step 3: Commit**

```bash
git add studio/docs/figma-export-setup.md
git commit -m "docs(studio/figma-export): one-time bridge plugin setup"
```

---

## Manual verification gates (real Figma, not unit-testable)

These are the go/no-go checks the whole effort exists to satisfy. Do them in order.

- [ ] **G1 — Transport:** With `pnpm run studio` running and the bridge plugin open in Figma Desktop, trigger an export of the existing `computer-chat` ComputerScene frame. Confirm the plugin receives `EXECUTE_CODE` and the frame appears in Figma.
- [ ] **G2 — Tier-1 fidelity:** In the exported frame, spot-check that Button/Chat Item/Bubble/Icon Button/Menu are **real component instances** (select one → it shows a main-component link), not raw frames.
- [ ] **G3 — Tier-2 fidelity:** Confirm text renders at the right **size/weight/color** (not all Inter Regular black), and unmapped containers carry their fills/radii — no empty gray boxes.
- [ ] **G4 — Side-by-side:** Screenshot the Figma result next to the Studio render of the same frame. This is the artifact the spec's success bar requires. Judge fidelity; log gaps (mixed-color text runs, gradients, images are known v1 limitations).
- [ ] **G5 — Packaged app:** Repeat G1 from the packaged `.app` (not just `pnpm run studio`) to confirm the bundled plugin manifest path + ws-bridge survive packaging.

---

## Out of scope (v2+, do NOT build here)
- Spacing/radius/typography **variable binding** (v1 binds color variables only; radius applied as a raw number).
- Multi-frame annotated flow (arrows, interaction annotations, overview) + any agent.
- Mixed-color/multi-weight text runs within one node, gradients, image fills, box-shadow, per-side borders.
- Growing the component/token map beyond current coverage + auto re-resolution of stale keys.
