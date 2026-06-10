# Figma Export — One-Click via the Desktop Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Export to Figma" one click — Studio opens a WebSocket server the existing Figma Desktop Bridge plugin connects to, sends a build script generated from the frame's SLJ, and the plugin builds the frame as real Arcade 0.3 component instances in Figma. No prompt, no Claude session.

**Architecture:** Studio impersonates the MCP server. A renderer helper serializes the selected frame to SLJ via a hidden iframe; a new endpoint generates a self-contained JS build script from that SLJ (`buildExecuteScript`, pure) and hands it to a WS server (`wsServer`) that sends it to the Bridge plugin as an `EXECUTE_CODE` frame; the plugin `eval`s it against the Figma API and replies. The build script codifies the proven live-run logic (local-node instancing, variants, label-via-TEXT-prop, icon child-swap, token binding) — building straight from our SLJ, no external converter or geometry matching.

**Tech Stack:** TypeScript, Vitest (node env), `ws` (already a dep), the existing `studio/src/export/figma/*` maps (`componentMap`, `iconMap`, `tokenMap`, `componentEntries`, `iconEntries`), `studio/src/lib/exportFrameToSlj.ts` (fiber-walk SLJ producer), `studio/src/lib/telemetry/*`, figma-console Desktop Bridge plugin (reused).

---

## Background the engineer needs

- **The Bridge protocol (verified from the plugin source).** The Figma Desktop Bridge plugin is a WebSocket **client**. It scans `ws://localhost:9223–9232` and connects to any open WS server. The **server** drives it by sending JSON frames `{ id: string, method: string, params: object }`; the plugin replies `{ id, result }` or `{ id, error: string }`. The method we use is `EXECUTE_CODE` with `params: { code: string, timeout: number }` — the plugin wraps `code` in an async IIFE and `eval`s it with the `figma` global available, returning the IIFE's value as `result`. Optional `{ type: "SERVER_HELLO", data: {...} }` identity frame on connect (plugin just logs it). Max code timeout 30000ms.

- **SLJ** (`studio/src/export/slj.ts`): `SljDocument { slj, frame:{slug,project,width,mode}, root: SljNode }`. `SljNode = ComponentNode | ElementNode`. `ComponentNode { kind:"component", component, source, props, box:Box, layout:Layout|null, children, icon?:string }`. `ElementNode { kind:"element", tag, box, layout, style:ElementStyle, children }`. `Box {x,y,width,height}`. `Layout { mode:"horizontal"|"vertical", gap, padding:[t,r,b,l], align }`. Guards `isComponentNode`, `isElementNode`.

- **The maps** (reused): `findComponentMapping(name)` → `FigmaComponentMapping | null` (`{arcadeGen, status, generation, figma:{componentSetKey,setName}|null, variants:VariantAxis[], textNode?, note}`). `findIconMapping(name)` → `IconMapping | null` (`{figma:{componentSetKey,setName}|null, ...}`). `buildTokenMap(snapshot.variables).tokenNameToVariableKey(css)` → key|null. Snapshot at `studio/src/export/figma/figma-variables.json` (`{variables:[...]}`).

- **The proven runtime logic** (from this session's live `figma_execute` runs, to codify): clone target → for each node, create frame (auto-layout from `Layout`) or instance; **resolve a component-set key to a LOCAL node** (search the file for a node whose `key` matches, else name-match `setName`; `importComponentByKeyAsync` is unreliable under library drift), pick the variant child (subset-match `variantProperties`), `createInstance()`; position by box relative to parent; set label via the component's TEXT property (match by base name before `#`, fallback to the largest TEXT node); swap the inner `Icons/*` child via `swapComponent` to a local Size-matched variant; bind token fills via `importVariableByKeyAsync` + `setBoundVariableForPaint`. Best-effort per node (instance-before-remove; icon/token failure never aborts).

- **`exportFrameToSlj`** (`studio/src/lib/exportFrameToSlj.ts`): `exportFrameToSlj({iframe, projectSlug, frameSlug, mode, width})` reads the iframe's live React tree (via `#root`'s `__reactContainer$`), walks it to SLJ, **POSTs it to `/api/projects/:slug/export/:frame.slj.json`** (so it's saved as `SLJ.json`), and returns the `SljDocument`. It needs a real frame iframe — currently it has NO production caller.

- **Frame URL:** `http://localhost:5556/api/frames/:projectSlug/:frameSlug` renders a frame standalone (this is what FrameCard's iframe loads).

- **ShareModal** (`studio/src/components/shell/ShareModal.tsx`): mounted by `ShareButton.tsx`, gets `projectSlug` + `frames: Frame[]`. Current "Export to Figma" button calls `handleCopyFigmaExport` (clipboard prompt). `track` from `../../lib/telemetry/renderer`. Frame radio sets `selectedFrame`.

- **Telemetry** (`studio/src/lib/telemetry/events.ts`): events are a typed union + `EVENT_NAMES` array; a new event name must be added to BOTH or it's a compile error. `track({name, props})` no-ops until init (safe to call anywhere). Current `figma_export_copied` event exists.

- **Middleware registration:** `studio/vite.config.ts` — `server.middlewares.use(<name>Middleware())` in the block ~line 58+. Middleware changes need a dev-server restart (no HMR).

- **Run tests from repo root:** `pnpm run studio:test <path>`. Node-env test files start `// @vitest-environment node`. Component tests mock `@xorkavi/arcade-gen`. Branch: `main` (current). Stage explicit paths; never `git add -A`/`.` (loose untracked files + `studio/CLAUDE.md`).

---

## File Structure

- `studio/server/figmaBridge/wsServer.ts` (new) — WS server that impersonates the MCP; `startBridgeServer()` → `BridgeServer` with `runCode`.
- `studio/src/export/figma/executePlan.ts` (new) — the compact plan type + `sljToExecutePlan(slj, maps)` (pure: SLJ → `ExecutePlanNode[]`).
- `studio/src/export/figma/buildExecuteScript.ts` (new) — `buildExecuteScript(slj, maps)` → JS string (embeds the plan from `sljToExecutePlan` + a fixed runtime).
- `studio/server/middleware/figmaExport.ts` (new) — `POST /api/projects/:slug/export/:frame/to-figma`.
- `studio/src/lib/serializeFrameForExport.ts` (new) — renderer helper: hidden-iframe serialize of a frame → SLJ (calls `exportFrameToSlj`).
- `studio/src/components/shell/ShareModal.tsx` (modify) — Export button runs the real flow + telemetry.
- `studio/src/lib/telemetry/events.ts` (modify) — add `figma_export_run`.
- `studio/vite.config.ts` (modify) — register `figmaExportMiddleware`.
- Tests alongside each new unit.

---

## Task 1: WS server that impersonates the MCP (`wsServer`)

**Files:**
- Create: `studio/server/figmaBridge/wsServer.ts`
- Test: `studio/__tests__/server/figmaBridge/wsServer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/figmaBridge/wsServer.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { startBridgeServer, type BridgeServer } from "../../../server/figmaBridge/wsServer";

let server: BridgeServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

/** Connect a fake "Bridge plugin" client to the server's port and act on
 *  EXECUTE_CODE frames the way the real plugin does. */
function fakePlugin(port: number, handler: (params: any) => unknown): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (!msg.id || !msg.method) return; // ignore SERVER_HELLO
      Promise.resolve(handler(msg.params))
        .then((result) => ws.send(JSON.stringify({ id: msg.id, result })))
        .catch((err) => ws.send(JSON.stringify({ id: msg.id, error: String(err.message ?? err) })));
    });
    ws.on("open", () => resolve(ws));
  });
}

describe("startBridgeServer", () => {
  it("binds a port in 9223-9232 and runCode round-trips through a connected client", async () => {
    server = await startBridgeServer();
    expect(server.port).toBeGreaterThanOrEqual(9223);
    expect(server.port).toBeLessThanOrEqual(9232);

    const client = await fakePlugin(server.port!, (params) => ({ echoed: params.code.length }));
    // give the connection a tick to register
    await new Promise((r) => setTimeout(r, 50));
    expect(server.isConnected()).toBe(true);

    const result = await server.runCode("return 1+1;", 5000) as any;
    expect(result.echoed).toBe("return 1+1;".length);
    client.close();
  });

  it("rejects runCode with a typed reason when no client is connected", async () => {
    server = await startBridgeServer();
    await expect(server.runCode("x", 1000)).rejects.toThrow(/no_bridge/);
  });

  it("rejects when the client returns an error frame", async () => {
    server = await startBridgeServer();
    const client = await fakePlugin(server.port!, () => { throw new Error("boom"); });
    await new Promise((r) => setTimeout(r, 50));
    await expect(server.runCode("x", 5000)).rejects.toThrow(/boom/);
    client.close();
  });

  it("rejects on timeout when the client never replies", async () => {
    server = await startBridgeServer();
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    await new Promise((r) => ws.on("open", r));
    await new Promise((r) => setTimeout(r, 50));
    await expect(server.runCode("x", 100)).rejects.toThrow(/timeout/);
    ws.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/figmaBridge/wsServer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/figmaBridge/wsServer.ts
import { WebSocketServer, type WebSocket } from "ws";

export interface BridgeServer {
  /** The bound port, or null if none free in 9223–9232. */
  port: number | null;
  /** True once a Bridge plugin client is connected. */
  isConnected(): boolean;
  /** Send an EXECUTE_CODE frame; resolve with the plugin's `result`, or reject
   *  ("no_bridge" | "timeout" | the plugin's error message). */
  runCode(code: string, timeoutMs: number): Promise<unknown>;
  close(): Promise<void>;
}

const PORT_START = 9223;
const PORT_END = 9232;

async function listenOnFreePort(): Promise<{ wss: WebSocketServer; port: number } | null> {
  for (let port = PORT_START; port <= PORT_END; port++) {
    const result = await new Promise<WebSocketServer | null>((resolve) => {
      const wss = new WebSocketServer({ host: "127.0.0.1", port });
      wss.once("listening", () => resolve(wss));
      wss.once("error", () => resolve(null));
    });
    if (result) return { wss: result, port };
  }
  return null;
}

export async function startBridgeServer(opts?: { hello?: Record<string, unknown> }): Promise<BridgeServer> {
  const bound = await listenOnFreePort();
  const wss = bound?.wss ?? null;
  const port = bound?.port ?? null;

  let client: WebSocket | null = null;
  let nextId = 1;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  wss?.on("connection", (ws) => {
    client = ws;
    try { ws.send(JSON.stringify({ type: "SERVER_HELLO", data: opts?.hello ?? { serverVersion: "studio" } })); } catch {}
    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg.id !== "string") return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if ("error" in msg) entry.reject(new Error(String(msg.error)));
      else entry.resolve(msg.result);
    });
    ws.on("close", () => { if (client === ws) client = null; });
  });

  return {
    port,
    isConnected: () => client !== null && client.readyState === 1,
    runCode(code, timeoutMs) {
      return new Promise((resolve, reject) => {
        if (!client || client.readyState !== 1) { reject(new Error("no_bridge: no Figma plugin connected")); return; }
        const id = String(nextId++);
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("timeout: Figma plugin did not reply")); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        client.send(JSON.stringify({ id, method: "EXECUTE_CODE", params: { code, timeout: timeoutMs } }));
      });
    },
    async close() {
      for (const [, e] of pending) { clearTimeout(e.timer); e.reject(new Error("no_bridge: server closing")); }
      pending.clear();
      await new Promise<void>((r) => { if (!wss) return r(); wss.close(() => r()); });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/figmaBridge/wsServer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/server/figmaBridge/wsServer.ts studio/__tests__/server/figmaBridge/wsServer.test.ts
git commit -m "feat(studio/export): WS server impersonating the MCP for the Figma Bridge"
```

---

## Task 2: SLJ → compact execute-plan (`executePlan`, pure)

**Files:**
- Create: `studio/src/export/figma/executePlan.ts`
- Test: `studio/__tests__/export/figma/executePlan.test.ts`

This is the pure transform from SLJ + maps to a flat, serializable plan the runtime consumes. Keeping it separate from the script-string builder (Task 3) makes the resolution logic unit-testable.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/executePlan.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sljToExecutePlan, type ExecutePlanMaps } from "../../../src/export/figma/executePlan";
import type { SljDocument } from "../../../src/export/slj";
import type { FigmaComponentMapping } from "../../../src/export/figma/types";

const bubble: FigmaComponentMapping = {
  arcadeGen: "ChatBubble", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "BUBBLE_KEY", setName: "Bubble" },
  variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver", sender: "Sender" } }],
  textNode: { strategy: "lowest-depth" }, note: "",
};
const iconButton: FigmaComponentMapping = {
  arcadeGen: "IconButton", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "IB_KEY", setName: "Icon Button" }, variants: [], note: "",
};
const maps: ExecutePlanMaps = {
  findComponentMapping: (n) => (n === "ChatBubble" ? bubble : n === "IconButton" ? iconButton : null),
  findIconSetKey: (i) => (i === "ChevronLeftSmall" ? "ICONS_CHEVRON_LEFT" : null),
  findIconSetName: (i) => (i === "ChevronLeftSmall" ? "Icons/Chevron.left" : null),
  tokenNameToVariableKey: (t) => (t === "--surface-overlay" ? "SURFACE_KEY" : null),
};

function doc(root: any): SljDocument {
  return { slj: 1, frame: { slug: "f", project: "p", width: 1280, mode: "light" }, root };
}

describe("sljToExecutePlan", () => {
  it("emits a frame node for an element with a token fill resolved to a variable key", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 600 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], align: "start" },
      style: { fill: "--surface-overlay" }, children: [],
    }), maps);
    expect(plan.root.kind).toBe("frame");
    expect(plan.root.layout).toEqual({ mode: "vertical", gap: 8, padding: [0, 0, 0, 0], align: "start" });
    expect(plan.root.fillVariableKey).toBe("SURFACE_KEY");
  });

  it("emits an instance node for a mapped component with variant + text + icon", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null, style: {},
      children: [{
        kind: "component", component: "IconButton", source: "arcade/components",
        props: { variant: "tertiary" }, box: { x: 10, y: 10, width: 20, height: 20 }, layout: null,
        children: [], icon: "ChevronLeftSmall",
      }],
    }), maps);
    const inst = plan.root.children[0];
    expect(inst.kind).toBe("instance");
    expect(inst.componentSetKey).toBe("IB_KEY");
    expect(inst.setName).toBe("Icon Button");
    expect(inst.iconSetKey).toBe("ICONS_CHEVRON_LEFT");
    expect(inst.iconSetName).toBe("Icons/Chevron.left");
    expect(inst.box).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it("emits a text node for a text element", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "text", box: { x: 0, y: 0, width: 80, height: 16 }, layout: null,
      style: { characters: "Sessions", color: "--fg-neutral-subtle" }, children: [],
    }), maps);
    expect(plan.root.kind).toBe("text");
    expect(plan.root.characters).toBe("Sessions");
  });

  it("an unmapped component degrades to a frame (so its children still build)", () => {
    const plan = sljToExecutePlan(doc({
      kind: "component", component: "MysteryComposite", source: "arcade-prototypes",
      props: {}, box: { x: 0, y: 0, width: 50, height: 50 }, layout: null, children: [],
    }), maps);
    expect(plan.root.kind).toBe("frame");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/executePlan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/export/figma/executePlan.ts
import type { Box, Layout, SljDocument, SljNode, ComponentNode, ElementNode } from "../slj";
import { isComponentNode } from "../slj";
import type { FigmaComponentMapping } from "./types";

export interface ExecutePlanMaps {
  findComponentMapping: (name: string) => FigmaComponentMapping | null;
  findIconSetKey: (arcadeGenIconName: string) => string | null;
  findIconSetName: (arcadeGenIconName: string) => string | null;
  tokenNameToVariableKey: (cssTokenName: string) => string | null;
}

/** A frame: a plain container (auto-layout when `layout` is set). */
export interface PlanFrame {
  kind: "frame";
  box: Box;
  layout: Layout | null;
  fillVariableKey?: string;   // bound variable for the fill
  fillColor?: string;         // raw rgb/hex fill when no token
  children: PlanNode[];
}
/** A real component instance. */
export interface PlanInstance {
  kind: "instance";
  componentSetKey: string;
  setName: string;                       // for local-node name fallback
  variant?: Record<string, string>;
  box: Box;
  text?: { propName?: string; characters: string };
  iconSetKey?: string;
  iconSetName?: string;
  children: PlanNode[];                   // always [] (prune-with-text); kept for shape uniformity
}
/** A text node. */
export interface PlanText {
  kind: "text";
  box: Box;
  characters: string;
  fillVariableKey?: string;
  fillColor?: string;
}
export type PlanNode = PlanFrame | PlanInstance | PlanText;

export interface ExecutePlan {
  frame: { slug: string; project: string; width: number; mode: "light" | "dark" };
  root: PlanNode;
}

function variantFor(mapping: FigmaComponentMapping, props: Record<string, unknown>): Record<string, string> | undefined {
  const v: Record<string, string> = {};
  for (const axis of mapping.variants) {
    const raw = props[axis.prop];
    if (typeof raw === "string" && axis.valueMap[raw] !== undefined) v[axis.figmaProp] = axis.valueMap[raw];
  }
  return Object.keys(v).length ? v : undefined;
}

function firstText(node: SljNode): string | null {
  if (node.kind === "element" && node.tag === "text" && node.style.characters !== undefined) return node.style.characters;
  for (const c of node.children) { const t = firstText(c); if (t !== null) return t; }
  return null;
}

function fillFields(maps: ExecutePlanMaps, value: string | undefined): { fillVariableKey?: string; fillColor?: string } {
  if (!value) return {};
  if (value.startsWith("--")) { const key = maps.tokenNameToVariableKey(value); return key ? { fillVariableKey: key } : {}; }
  return { fillColor: value };
}

export function sljToExecutePlan(slj: SljDocument, maps: ExecutePlanMaps): ExecutePlan {
  function walk(node: SljNode): PlanNode {
    if (isComponentNode(node)) {
      const m = maps.findComponentMapping(node.component);
      if (m && m.status === "mapped" && m.figma) {
        const text = firstText(node);
        const textPayload =
          text !== null && m.textNode
            ? m.textNode.strategy === "by-name"
              ? { propName: m.textNode.name, characters: text }
              : { characters: text }
            : undefined;
        const inst: PlanInstance = {
          kind: "instance",
          componentSetKey: m.figma.componentSetKey,
          setName: m.figma.setName,
          variant: variantFor(m, node.props),
          box: node.box,
          text: textPayload,
          children: [],
        };
        if (node.icon) {
          const k = maps.findIconSetKey(node.icon);
          if (k) { inst.iconSetKey = k; inst.iconSetName = maps.findIconSetName(node.icon) ?? undefined; }
        }
        return inst;
      }
      // unmapped component → frame that still recurses
      return { kind: "frame", box: node.box, layout: node.layout, children: node.children.map(walk) };
    }
    // element
    const el = node as ElementNode;
    if (el.tag === "text" && el.style.characters !== undefined) {
      return { kind: "text", box: el.box, characters: el.style.characters, ...fillFields(maps, el.style.color) };
    }
    return { kind: "frame", box: el.box, layout: el.layout, ...fillFields(maps, el.style.fill), children: el.children.map(walk) };
  }
  return { frame: slj.frame, root: walk(slj.root) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/executePlan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/executePlan.ts studio/__tests__/export/figma/executePlan.test.ts
git commit -m "feat(studio/export): pure SLJ → execute-plan transform"
```

---

## Task 3: Build the self-contained execute script (`buildExecuteScript`)

**Files:**
- Create: `studio/src/export/figma/buildExecuteScript.ts`
- Test: `studio/__tests__/export/figma/buildExecuteScript.test.ts`

`buildExecuteScript(slj, maps)` = `sljToExecutePlan` + embed the plan as JSON into a fixed runtime string. The runtime is plain JS that runs in the Figma plugin sandbox (no TS, no imports, no optional chaining — the sandbox is conservative).

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/export/figma/buildExecuteScript.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildExecuteScript } from "../../../src/export/figma/buildExecuteScript";
import type { SljDocument } from "../../../src/export/slj";
import type { ExecutePlanMaps } from "../../../src/export/figma/executePlan";
import type { FigmaComponentMapping } from "../../../src/export/figma/types";

const iconButton: FigmaComponentMapping = {
  arcadeGen: "IconButton", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "IB_KEY", setName: "Icon Button" }, variants: [], note: "",
};
const maps: ExecutePlanMaps = {
  findComponentMapping: (n) => (n === "IconButton" ? iconButton : null),
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};
const slj: SljDocument = {
  slj: 1, frame: { slug: "computer", project: "p", width: 1280, mode: "light" },
  root: {
    kind: "element", tag: "div", box: { x: 0, y: 0, width: 1280, height: 600 }, layout: null, style: {},
    children: [{
      kind: "component", component: "IconButton", source: "arcade/components",
      props: {}, box: { x: 10, y: 10, width: 20, height: 20 }, layout: null, children: [],
    }],
  },
};

describe("buildExecuteScript", () => {
  it("returns a non-empty JS string embedding the plan", () => {
    const code = buildExecuteScript(slj, maps);
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(100);
    // the embedded plan carries the component-set key
    expect(code).toContain("IB_KEY");
    // references the figma API + returns a result object
    expect(code).toContain("figma.createFrame");
    expect(code).toContain("createInstance");
    expect(code).toMatch(/return\s+\{/);
  });

  it("embeds the plan as valid JSON (parseable substring)", () => {
    const code = buildExecuteScript(slj, maps);
    const m = code.match(/var __PLAN__\s*=\s*(\{[\s\S]*?\});/);
    expect(m).not.toBeNull();
    const plan = JSON.parse(m![1]);
    expect(plan.frame.slug).toBe("computer");
    expect(plan.root.children[0].componentSetKey).toBe("IB_KEY");
  });

  it("does not use optional chaining or TS (sandbox-safe)", () => {
    const code = buildExecuteScript(slj, maps);
    expect(code).not.toContain("?.");
    expect(code).not.toContain(": string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/export/figma/buildExecuteScript.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

The runtime is the codified, proven live-run logic. It's a template string; only `__PLAN__` varies. Keep it ES5-ish (no `?.`, no `??` — use explicit checks).

```ts
// studio/src/export/figma/buildExecuteScript.ts
import type { SljDocument } from "../slj";
import { sljToExecutePlan, type ExecutePlanMaps } from "./executePlan";

/** The fixed runtime that runs inside the Figma plugin sandbox. Reads a global
 *  `__PLAN__` (injected below) and builds the frame: frames (auto-layout) +
 *  real component instances (local-node resolve, variant, label, icon swap,
 *  token fill). Best-effort per node. Returns a summary. Plain ES5-ish JS —
 *  no optional chaining, no TS. */
const RUNTIME = `
var made = { frames: 0, instances: 0, icons: 0, binds: 0, fail: 0 };
var errs = [];
var setCache = {};
var fonts = {};

async function getLocalSet(key, setName) {
  if (setCache[key]) return setCache[key];
  // 1) try import by key (works when published + reachable)
  var found = null;
  try { found = await figma.importComponentSetByKeyAsync(key); } catch (e) {}
  // 2) fall back to a local node whose key matches, else name-match
  if (!found) {
    var all = figma.root.findAllWithCriteria ? figma.root.findAllWithCriteria({ types: ["COMPONENT_SET"] }) : [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].key === key) { found = all[i]; break; }
    }
    if (!found && setName) {
      for (var j = 0; j < all.length; j++) {
        if (all[j].name === setName && !/DEPREC|DLS|WIP/.test(all[j].name)) { found = all[j]; break; }
      }
    }
  }
  setCache[key] = found;
  return found;
}

function pickVariant(set, variant) {
  var comps = set.children.filter(function (c) { return c.type === "COMPONENT"; });
  if (variant) {
    for (var i = 0; i < comps.length; i++) {
      var vp = comps[i].variantProperties || {};
      var ok = true;
      for (var k in variant) { if (vp[k] !== variant[k]) { ok = false; break; } }
      if (ok) return comps[i];
    }
  }
  return set.defaultVariant || comps[0] || null;
}

async function ensureFont(fn) {
  var k = fn.family + "|" + fn.style;
  if (fonts[k]) return true;
  try { await figma.loadFontAsync(fn); fonts[k] = true; return true; } catch (e) { return false; }
}

async function setLabel(inst, propName, chars) {
  if (propName) {
    try {
      var defs = inst.componentProperties || {};
      var base = propName.split("#")[0];
      for (var key in defs) {
        if (defs[key].type === "TEXT" && (key === propName || key.split("#")[0] === base)) {
          var p = {}; p[key] = chars; inst.setProperties(p); return;
        }
      }
    } catch (e) {}
  }
  var texts = inst.findAll ? inst.findAll(function (n) { return n.type === "TEXT"; }) : [];
  if (!texts.length) return;
  texts.sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); });
  var t = texts[0];
  if (!(await ensureFont(t.fontName))) return;
  try { t.characters = chars; } catch (e) {}
}

async function setIcon(inst, iconKey, iconName) {
  var child = inst.findOne ? inst.findOne(function (n) { return n.type === "INSTANCE" && /Icons\\//.test(n.name); }) : null;
  if (!child) return;
  var set = await getLocalSet(iconKey, iconName);
  if (!set || !set.children) return;
  var comps = set.children.filter(function (c) { return c.type === "COMPONENT"; });
  var target = null;
  for (var i = 0; i < comps.length; i++) { if ((comps[i].variantProperties || {}).Size === "16") { target = comps[i]; break; } }
  if (!target) target = set.defaultVariant || comps[0];
  if (target) { try { child.swapComponent(target); } catch (e) {} }
}

var varCache = {};
async function bindFill(node, varKey) {
  if (!("fills" in node)) return;
  var v = varCache[varKey];
  if (v === undefined) { try { v = await figma.variables.importVariableByKeyAsync(varKey); } catch (e) { v = null; } varCache[varKey] = v; }
  if (!v || v.resolvedType !== "COLOR") return;
  try {
    var base = (node.fills && node.fills[0]) ? Object.assign({}, node.fills[0]) : { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
    node.fills = [figma.variables.setBoundVariableForPaint(base, "color", v)];
    made.binds++;
  } catch (e) {}
}

function setSolid(node, color) {
  if (!("fills" in node)) return;
  var m = String(color).match(/rgba?\\(([^)]+)\\)/);
  var rgb = null;
  if (m) { var p = m[1].split(",").map(function (s) { return parseFloat(s.trim()); }); rgb = { r: p[0]/255, g: p[1]/255, b: p[2]/255, a: p[3] == null ? 1 : p[3] }; }
  else if (color[0] === "#") { var h = color.slice(1); rgb = { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255, a: 1 }; }
  if (rgb) { try { node.fills = [{ type: "SOLID", color: { r: rgb.r, g: rgb.g, b: rgb.b }, opacity: rgb.a }]; } catch (e) {} }
}

function applyLayout(frame, layout) {
  if (!layout) { frame.layoutMode = "NONE"; return; }
  frame.layoutMode = layout.mode === "horizontal" ? "HORIZONTAL" : "VERTICAL";
  frame.itemSpacing = layout.gap || 0;
  var pad = layout.padding || [0,0,0,0];
  frame.paddingTop = pad[0]; frame.paddingRight = pad[1]; frame.paddingBottom = pad[2]; frame.paddingLeft = pad[3];
  frame.counterAxisAlignItems = layout.align === "center" ? "CENTER" : (layout.align === "end" ? "MAX" : "MIN");
  frame.primaryAxisSizingMode = "FIXED"; frame.counterAxisSizingMode = "FIXED";
}

// Build a node under `parent` (absolute origin ox/oy of the whole export root).
async function build(node, parent, ox, oy) {
  if (node.kind === "instance") {
    var set = await getLocalSet(node.componentSetKey, node.setName);
    if (!set) { made.fail++; if (errs.length < 12) errs.push("set " + node.setName); return; }
    var comp = pickVariant(set, node.variant || null);
    if (!comp) { made.fail++; return; }
    var inst = comp.createInstance();
    parent.appendChild(inst);
    try { if (node.box.width > 0 && node.box.height > 0) inst.resize(node.box.width, node.box.height); } catch (e) {}
    inst.x = node.box.x - ox; inst.y = node.box.y - oy;
    if (node.text) await setLabel(inst, node.text.propName || null, node.text.characters);
    if (node.iconSetKey) { await setIcon(inst, node.iconSetKey, node.iconSetName || ""); made.icons++; }
    made.instances++;
    return;
  }
  if (node.kind === "text") {
    var t = figma.createText();
    parent.appendChild(t);
    if (await ensureFont({ family: "Inter", style: "Regular" })) { try { t.fontName = { family: "Inter", style: "Regular" }; } catch (e) {} }
    try { t.characters = node.characters; } catch (e) {}
    t.x = node.box.x - ox; t.y = node.box.y - oy;
    if (node.fillVariableKey) await bindFill(t, node.fillVariableKey); else if (node.fillColor) setSolid(t, node.fillColor);
    return;
  }
  // frame
  var f = figma.createFrame();
  f.name = "frame";
  f.fills = [];
  applyLayout(f, node.layout);
  parent.appendChild(f);
  try { f.resizeWithoutConstraints(Math.max(node.box.width, 1), Math.max(node.box.height, 1)); } catch (e) {}
  f.x = node.box.x - ox; f.y = node.box.y - oy;
  if (node.fillVariableKey) await bindFill(f, node.fillVariableKey); else if (node.fillColor) setSolid(f, node.fillColor);
  made.frames++;
  // children: when this frame is NON-auto-layout, position children absolutely
  // relative to THIS frame's origin; when auto-layout, let Figma place them.
  var childOx = node.layout ? null : node.box.x;
  var childOy = node.layout ? null : node.box.y;
  for (var i = 0; i < node.children.length; i++) {
    await build(node.children[i], f, childOx == null ? ox : childOx, childOy == null ? oy : childOy);
  }
}

var __root = __PLAN__.root;
var pageRoot = figma.createFrame();
pageRoot.name = "Arcade Export — " + __PLAN__.frame.slug;
pageRoot.fills = [];
pageRoot.layoutMode = "NONE";
figma.currentPage.appendChild(pageRoot);
try { pageRoot.resizeWithoutConstraints(Math.max(__root.box.width, 1), Math.max(__root.box.height, 1)); } catch (e) {}
// root's children build relative to root's own origin
var rOx = __root.box.x, rOy = __root.box.y;
if (__root.kind === "frame" && !__root.layout) {
  if (__root.fillVariableKey) await bindFill(pageRoot, __root.fillVariableKey); else if (__root.fillColor) setSolid(pageRoot, __root.fillColor);
  for (var i = 0; i < __root.children.length; i++) await build(__root.children[i], pageRoot, rOx, rOy);
} else {
  // root carries layout or is itself a component/text — build it as a child of pageRoot
  await build(__root, pageRoot, rOx, rOy);
}
pageRoot.x = 0; pageRoot.y = 0;
figma.currentPage.selection = [pageRoot];
figma.viewport.scrollAndZoomIntoView([pageRoot]);
return { made: made, errs: errs, rootId: pageRoot.id };
`;

export function buildExecuteScript(slj: SljDocument, maps: ExecutePlanMaps): string {
  const plan = sljToExecutePlan(slj, maps);
  return `var __PLAN__ = ${JSON.stringify(plan)};\n${RUNTIME}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/export/figma/buildExecuteScript.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/export/figma/buildExecuteScript.ts studio/__tests__/export/figma/buildExecuteScript.test.ts
git commit -m "feat(studio/export): build self-contained Figma build script from SLJ"
```

---

## Task 4: The export endpoint (`figmaExport` middleware)

**Files:**
- Create: `studio/server/middleware/figmaExport.ts`
- Test: `studio/__tests__/server/figmaExport.test.ts`

The middleware ties it together. It holds a lazily-started singleton `BridgeServer`. To keep it testable, the server factory + maps are injectable.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/server/figmaExport.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { handleFigmaExport, type FigmaExportDeps } from "../../server/middleware/figmaExport";
import type { SljDocument } from "../../src/export/slj";

const slj: SljDocument = {
  slj: 1, frame: { slug: "computer", project: "p", width: 1280, mode: "light" },
  root: { kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null, style: {}, children: [] },
};

function deps(over: Partial<FigmaExportDeps> = {}): FigmaExportDeps {
  return {
    loadSlj: async () => slj,
    getBridge: async () => ({
      port: 9223, isConnected: () => true,
      runCode: async () => ({ made: { instances: 5, frames: 10, icons: 2, binds: 3, fail: 0 }, errs: [], rootId: "1:2" }),
      close: async () => {},
    }),
    ...over,
  };
}

describe("handleFigmaExport", () => {
  it("returns ok + summary on a successful run", async () => {
    const out = await handleFigmaExport("p", "computer", deps());
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    expect(out.body.summary.made.instances).toBe(5);
  });

  it("returns no_bridge when the plugin is not connected", async () => {
    const out = await handleFigmaExport("p", "computer", deps({
      getBridge: async () => ({ port: 9223, isConnected: () => false, runCode: async () => { throw new Error("x"); }, close: async () => {} }),
    }));
    expect(out.status).toBe(409);
    expect(out.body.error.code).toBe("no_bridge");
  });

  it("returns 404 when the frame has no SLJ", async () => {
    const out = await handleFigmaExport("p", "missing", deps({ loadSlj: async () => null }));
    expect(out.status).toBe(404);
  });

  it("returns exec_error when the bridge run rejects", async () => {
    const out = await handleFigmaExport("p", "computer", deps({
      getBridge: async () => ({ port: 9223, isConnected: () => true, runCode: async () => { throw new Error("boom in figma"); }, close: async () => {} }),
    }));
    expect(out.status).toBe(502);
    expect(out.body.error.code).toBe("exec_error");
    expect(out.body.error.message).toContain("boom in figma");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/server/figmaExport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/server/middleware/figmaExport.ts
//
// POST /api/projects/:slug/export/:frame/to-figma
// Loads the frame's stored SLJ, builds the Figma build script, and runs it
// through the Bridge WS server (which the Figma Desktop Bridge plugin connects
// to). One EXECUTE_CODE round trip. Returns { ok, summary } or a typed error.
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import type { SljDocument } from "../../src/export/slj";
import { buildExecuteScript } from "../../src/export/figma/buildExecuteScript";
import { findComponentMapping } from "../../src/export/figma/componentMap";
import { findIconMapping } from "../../src/export/figma/iconMap";
import { buildTokenMap } from "../../src/export/figma/tokenMap";
import variablesSnapshot from "../../src/export/figma/figma-variables.json";
import { startBridgeServer, type BridgeServer } from "../figmaBridge/wsServer";

const ROUTE = /^\/api\/projects\/([a-z0-9-]+)\/export\/([a-z0-9-]+)\/to-figma(?:\?.*)?$/;
const EXEC_TIMEOUT_MS = 30_000;

export interface FigmaExportDeps {
  loadSlj: (slug: string, frame: string) => Promise<SljDocument | null>;
  getBridge: () => Promise<BridgeServer>;
}

export interface FigmaExportResult {
  status: number;
  body: any;
}

const tokenMap = buildTokenMap((variablesSnapshot as { variables: any[] }).variables);
const MAPS = {
  findComponentMapping,
  findIconSetKey: (n: string) => { const m = findIconMapping(n); return m && m.figma ? m.figma.componentSetKey : null; },
  findIconSetName: (n: string) => { const m = findIconMapping(n); return m && m.figma ? m.figma.setName : null; },
  tokenNameToVariableKey: tokenMap.tokenNameToVariableKey,
};

/** Pure handler — tested directly; the middleware wraps it with HTTP plumbing. */
export async function handleFigmaExport(slug: string, frame: string, deps: FigmaExportDeps): Promise<FigmaExportResult> {
  const slj = await deps.loadSlj(slug, frame);
  if (!slj) return { status: 404, body: { error: { code: "not_found", message: "No SLJ for this frame — open it first" } } };

  const bridge = await deps.getBridge();
  if (!bridge.isConnected()) {
    return { status: 409, body: { error: { code: "no_bridge", message: "No Figma plugin connected. Open the Arcade export plugin in Figma, then try again." } } };
  }

  const code = buildExecuteScript(slj, MAPS);
  try {
    const result = await bridge.runCode(code, EXEC_TIMEOUT_MS);
    return { status: 200, body: { ok: true, summary: result } };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/^no_bridge/.test(msg)) return { status: 409, body: { error: { code: "no_bridge", message: msg } } };
    if (/^timeout/.test(msg)) return { status: 504, body: { error: { code: "timeout", message: msg } } };
    return { status: 502, body: { error: { code: "exec_error", message: msg } } };
  }
}

// --- live deps (singleton bridge) ---
let bridgeSingleton: BridgeServer | null = null;
async function liveGetBridge(): Promise<BridgeServer> {
  if (!bridgeSingleton) bridgeSingleton = await startBridgeServer({ hello: { serverVersion: "studio" } });
  return bridgeSingleton;
}
async function liveLoadSlj(slug: string, frame: string): Promise<SljDocument | null> {
  try {
    const raw = await fs.readFile(path.join(frameDir(slug, frame), "SLJ.json"), "utf-8");
    return JSON.parse(raw) as SljDocument;
  } catch { return null; }
}

export function figmaExportMiddleware() {
  // Start the bridge eagerly so the plugin can connect before the first export.
  void liveGetBridge();
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const m = (req.url ?? "/").match(ROUTE);
    if (!m || req.method !== "POST") return next?.();
    const [, slug, frame] = m;
    // drain body (none expected, but consume to free the socket)
    for await (const _ of req) { /* ignore */ }
    const out = await handleFigmaExport(slug, frame, { loadSlj: liveLoadSlj, getBridge: liveGetBridge });
    res.writeHead(out.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(out.body));
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/server/figmaExport.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the middleware**

In `studio/vite.config.ts`, add the import near the other middleware imports:
```ts
import { figmaExportMiddleware } from "./server/middleware/figmaExport";
```
And register it alongside `exportMiddleware()` in the `server.middlewares.use(...)` block:
```ts
      server.middlewares.use(figmaExportMiddleware());
```

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/figmaExport.ts studio/__tests__/server/figmaExport.test.ts studio/vite.config.ts
git commit -m "feat(studio/export): /to-figma endpoint runs the build script over the Bridge"
```

---

## Task 5: Renderer serialize helper (`serializeFrameForExport`)

**Files:**
- Create: `studio/src/lib/serializeFrameForExport.ts`
- Test: `studio/__tests__/lib/serializeFrameForExport.test.ts`

The endpoint needs a fresh `SLJ.json`. `exportFrameToSlj` produces it but needs a frame iframe + POSTs it. This helper mounts a hidden iframe at the frame URL, waits for it to load + data to settle, calls `exportFrameToSlj` (which saves the SLJ), then removes the iframe. Pure-DOM, injectable timers for tests.

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lib/serializeFrameForExport.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { serializeFrameForExport } from "../../src/lib/serializeFrameForExport";

describe("serializeFrameForExport", () => {
  it("mounts a hidden iframe, runs the serializer on load, and cleans up", async () => {
    const fakeSlj = { slj: 1, frame: { slug: "f", project: "p", width: 1280, mode: "light" }, root: {} };
    const serialize = vi.fn(async () => fakeSlj as any);

    const promise = serializeFrameForExport(
      { projectSlug: "p", frameSlug: "f", width: 1280, mode: "light" },
      { serialize, settleMs: 0 },
    );

    // an iframe was added to the document
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toContain("/api/frames/p/f");

    // simulate it loading
    iframe!.dispatchEvent(new Event("load"));

    const result = await promise;
    expect(result).toBe(fakeSlj);
    expect(serialize).toHaveBeenCalledOnce();
    // cleaned up
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("rejects if the iframe never loads within the timeout", async () => {
    await expect(
      serializeFrameForExport(
        { projectSlug: "p", frameSlug: "f", width: 1280, mode: "light" },
        { serialize: async () => ({} as any), settleMs: 0, loadTimeoutMs: 10 },
      ),
    ).rejects.toThrow(/timed out/i);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/lib/serializeFrameForExport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// studio/src/lib/serializeFrameForExport.ts
import { exportFrameToSlj } from "./exportFrameToSlj";
import type { SljDocument } from "../export/slj";

export interface SerializeArgs {
  projectSlug: string;
  frameSlug: string;
  width: number;
  mode: "light" | "dark";
}

export interface SerializeOpts {
  /** Injectable for tests; defaults to the real exportFrameToSlj. */
  serialize?: (args: { iframe: HTMLIFrameElement } & SerializeArgs) => Promise<SljDocument>;
  /** Wait after load for async frame data (chat data) to settle. Default 2500ms. */
  settleMs?: number;
  /** Max wait for the iframe load event. Default 15000ms. */
  loadTimeoutMs?: number;
}

/** Mount a hidden iframe at the frame URL, serialize its rendered React tree to
 *  SLJ once loaded + settled, then clean up. The serializer (exportFrameToSlj)
 *  also POSTs the SLJ so the server has a fresh SLJ.json. */
export function serializeFrameForExport(args: SerializeArgs, opts: SerializeOpts = {}): Promise<SljDocument> {
  const serialize = opts.serialize ?? exportFrameToSlj;
  const settleMs = opts.settleMs ?? 2500;
  const loadTimeoutMs = opts.loadTimeoutMs ?? 15000;

  return new Promise<SljDocument>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:absolute;width:1280px;height:900px;left:-99999px;top:0;border:0;visibility:hidden;";
    iframe.src = `/api/frames/${args.projectSlug}/${args.frameSlug}?mode=${args.mode}`;

    let done = false;
    const cleanup = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
    const fail = (e: Error) => { if (done) return; done = true; clearTimeout(timer); cleanup(); reject(e); };
    const ok = (slj: SljDocument) => { if (done) return; done = true; clearTimeout(timer); cleanup(); resolve(slj); };

    const timer = setTimeout(() => fail(new Error("Frame load timed out")), loadTimeoutMs);

    iframe.addEventListener("load", () => {
      setTimeout(async () => {
        try {
          const slj = await serialize({ iframe, ...args });
          ok(slj);
        } catch (e: any) {
          fail(e instanceof Error ? e : new Error(String(e)));
        }
      }, settleMs);
    });

    document.body.appendChild(iframe);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/lib/serializeFrameForExport.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/serializeFrameForExport.ts studio/__tests__/lib/serializeFrameForExport.test.ts
git commit -m "feat(studio/export): hidden-iframe frame serializer for export"
```

---

## Task 6: Telemetry event + ShareModal wiring

**Files:**
- Modify: `studio/src/lib/telemetry/events.ts`
- Modify: `studio/src/components/shell/ShareModal.tsx`
- Test: `studio/__tests__/components/share-modal-cert-probe.test.tsx` (extend)

- [ ] **Step 1: Add the telemetry event (events.ts)**

Replace the existing `figma_export_copied` event with `figma_export_run` (the copy path is being removed). In the `TelemetryEvent` union:
```ts
  // --- figma export (renderer) ---
  | { name: "figma_export_run"; props: { outcome: "ok" | "no_bridge" | "error"; instance_count?: number; failure_count?: number } }
```
And in `EVENT_NAMES`, replace `"figma_export_copied",` with `"figma_export_run",`.

- [ ] **Step 2: Write the failing ShareModal test (append to share-modal-cert-probe.test.tsx)**

The test mocks the renderer telemetry (`trackSpy`) and the serializer. Add:
```ts
vi.mock("../../src/lib/serializeFrameForExport", () => ({
  serializeFrameForExport: vi.fn(async () => ({ slj: 1, frame: { slug: "hero", project: "test-proj", width: 1440, mode: "light" }, root: {} })),
}));

describe("ShareModal — Export to Figma (one-click)", () => {
  it("serializes the frame, posts to /to-figma, shows success, and fires figma_export_run", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const u = String(input);
      if (u.endsWith("/to-figma") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, summary: { made: { instances: 7, fail: 0 } } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<ShareModal open={true} onClose={() => {}} projectSlug="test-proj" frames={FRAMES} />);
    fireEvent.click(screen.getByDisplayValue("hero"));
    fireEvent.click(screen.getByText("Export to Figma"));

    await waitFor(() => expect(screen.getByText(/Opened in Figma/i)).toBeTruthy());
    expect(fetchSpy.mock.calls.some(([u, i]) => String(u).endsWith("/to-figma") && (i as any)?.method === "POST")).toBe(true);
    expect(trackSpy).toHaveBeenCalledWith({ name: "figma_export_run", props: expect.objectContaining({ outcome: "ok" }) });
  });

  it("shows an actionable message when the plugin isn't connected (no_bridge)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (String(input).endsWith("/to-figma")) return new Response(JSON.stringify({ error: { code: "no_bridge", message: "no plugin" } }), { status: 409 });
      return new Response("{}", { status: 200 });
    }));
    render(<ShareModal open={true} onClose={() => {}} projectSlug="test-proj" frames={FRAMES} />);
    fireEvent.click(screen.getByDisplayValue("hero"));
    fireEvent.click(screen.getByText("Export to Figma"));
    await waitFor(() => expect(screen.getByText(/Open the Arcade export plugin in Figma/i)).toBeTruthy());
    expect(trackSpy).toHaveBeenCalledWith({ name: "figma_export_run", props: expect.objectContaining({ outcome: "no_bridge" }) });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/components/share-modal-cert-probe.test.tsx`
Expected: FAIL — `Export to Figma` still copies a prompt; no `/to-figma` POST; events differ.

- [ ] **Step 4: Rewire ShareModal**

Replace the import of `wrapFigmaExportPrompt` with the serializer; rename state `figmaCopied`→`figmaExporting`/`figmaError`; replace `handleCopyFigmaExport` with the real flow; update the button label/states. Edits:

(a) imports — drop `wrapFigmaExportPrompt`, add:
```ts
import { serializeFrameForExport } from "../../lib/serializeFrameForExport";
```

(b) state — replace `const [figmaCopied, setFigmaCopied] = useState(false);` with:
```ts
  const [figmaPhase, setFigmaPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [figmaError, setFigmaError] = useState<string | null>(null);
```

(c) handler — replace `handleCopyFigmaExport` with:
```ts
  async function handleExportToFigma() {
    if (!selectedFrame) return;
    const frameObj = frames.find((f) => f.slug === selectedFrame);
    setFigmaPhase("running");
    setFigmaError(null);
    try {
      // 1. produce a fresh SLJ from the frame's live render (hidden iframe).
      await serializeFrameForExport({
        projectSlug,
        frameSlug: selectedFrame,
        width: frameObj ? frameObj.size : 1280,
        mode: "light",
      });
      // 2. run the build over the Bridge.
      const res = await fetch(`/api/projects/${projectSlug}/export/${selectedFrame}/to-figma`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setFigmaPhase("done");
        track({ name: "figma_export_run", props: { outcome: "ok", instance_count: data.summary?.made?.instances, failure_count: data.summary?.made?.fail } });
        setTimeout(() => setFigmaPhase("idle"), 2500);
      } else {
        const code = data.error?.code;
        const msg = code === "no_bridge"
          ? "Open the Arcade export plugin in Figma, then try again."
          : (data.error?.message ?? "Export failed.") + " Check Figma is on the Arcade UI Kit library.";
        setFigmaError(msg);
        setFigmaPhase("error");
        track({ name: "figma_export_run", props: { outcome: code === "no_bridge" ? "no_bridge" : "error" } });
      }
    } catch (err: any) {
      setFigmaError(err?.message ?? "Export failed.");
      setFigmaPhase("error");
      track({ name: "figma_export_run", props: { outcome: "error" } });
    }
  }
```

(d) the button — replace the Figma button JSX with:
```tsx
              <Button
                variant="secondary"
                onClick={handleExportToFigma}
                disabled={!selectedFrame || loading || figmaPhase === "running" || frames.length === 0}
              >
                {figmaPhase === "running" ? "Exporting…" : figmaPhase === "done" ? "Opened in Figma ✓" : "Export to Figma"}
              </Button>
```

(e) surface `figmaError` — reuse the existing `error` alert block by also showing `figmaError`. Simplest: in the existing `{error && (...)}` alert, change the condition to `{(error || figmaError) && (...)}` and render `{error || figmaError}`.

(f) `handleClose` — reset the new state: replace `setFigmaCopied(false);` with `setFigmaPhase("idle"); setFigmaError(null);`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/components/share-modal-cert-probe.test.tsx studio/__tests__/lib/telemetry/events.test.ts`
Expected: PASS — the existing cert-probe tests, the 2 new export tests, and the events catalog test.

- [ ] **Step 6: Commit**

```bash
git add studio/src/lib/telemetry/events.ts studio/src/components/shell/ShareModal.tsx studio/__tests__/components/share-modal-cert-probe.test.tsx
git commit -m "feat(studio/export): one-click Export to Figma in ShareModal + telemetry"
```

---

## Task 7: Full suite + live run

**Files:** none (verification).

- [ ] **Step 1: Full suite green**

Run: `pnpm run studio:test`
Expected: PASS (existing + all new tests). Note counts. (The `__tests__/poc/*` live-CLI test can flake — re-run once if it's the only failure.)

- [ ] **Step 2: Live run — the proof**

1. Restart the dev server (middleware change): `pnpm run studio`.
2. Open Figma desktop on the Arcade UI Kit v0.3 library; run the **Figma Desktop Bridge** plugin (it scans 9223–9232 and connects to Studio's server).
3. In Studio, open a project with a populated Computer-with-panel frame; open the Share dialog; select the frame; click **Export to Figma**.
4. Expected: button → "Exporting…" → "Opened in Figma ✓"; in Figma a new frame appears with the real two-pane UI — real Chat Item rows, real ChatBubbles, real chevron/clock/send glyphs. Screenshot it.
5. Negative check: quit the Bridge plugin, click Export → modal shows "Open the Arcade export plugin in Figma, then try again." (no hang).

- [ ] **Step 3: Record the result**

Update the spec's "Done =" with the observed instance count + a one-line verdict. If the live run surfaces a script bug (e.g. a layout/positioning issue), fix it in `buildExecuteScript.ts`'s RUNTIME (the only place live-only behavior lives) and add a `buildExecuteScript` assertion if the bug was plan-shaped.

```bash
git add docs/superpowers/specs/2026-06-10-figma-export-one-click-design.md
git commit -m "docs(studio/export): one-click export verified live — <summary>"
```

---

## Task 8: Decide on the old reconciliation units + PR

- [ ] **Step 1: Decide retire-or-keep**

Now that the Bridge path works, the converter-reconciliation units (`captureTree`, `geometryMatch`, `swapPlan`, `executeSwap`, `runSwap`, `wrapFigmaExportPrompt`) are unused by any production path. Confirm with the user: delete them (one export path, no dead code) or keep as a documented fallback. Default recommendation: delete + their tests. If deleting, grep first to confirm no remaining importer:
```bash
grep -rn "captureTree\|geometryMatch\|swapPlan\|executeSwap\|runSwap\|wrapFigmaExportPrompt" studio/src studio/server studio/__tests__ | grep -v "executePlan\|buildExecuteScript"
```

- [ ] **Step 2: Full suite + push**

Run: `pnpm run studio:test` (green). Then:
```bash
git push origin main
```
(Or open a PR if the team prefers review before merge.)

---

## Self-review notes

- **Spec coverage:** Bridge protocol impersonation (T1) ✓; build straight from SLJ, no converter (T2+T3) ✓; codified proven runtime — local-node instancing, variants, label-by-prop, icon swap, token bind (T3 RUNTIME) ✓; endpoint with typed errors no_bridge/exec_error/timeout (T4) ✓; fresh-SLJ via hidden-iframe serialize, scoped to selected frame (T5) ✓; ShareModal one-click + figma_export_run telemetry + actionable failure copy (T6) ✓; live screenshot run (T7) ✓; old-units decision deferred to end (T8) ✓.
- **Type consistency:** `ExecutePlanMaps` (T2) consumed by `buildExecuteScript` (T3) + `figmaExport` MAPS (T4); `BridgeServer` (T1) consumed by `figmaExport` deps (T4); `ExecutePlan` JSON embedded as `__PLAN__` (T3) consumed by RUNTIME; `figma_export_run` (T6) matches the telemetry union shape.
- **Carried-over test maintenance:** removing `figma_export_copied` from the union means any test referencing it breaks — the only one is the export test in share-modal-cert-probe, rewritten in T6. The ShareModal arcade-gen mock already has IconButton/CrossSmall/Modal.Close from the prior change.
- **Risks (from spec):** plugin-not-running → no_bridge fast-fail (T4); 30s cap → single batched run, chunk later if needed; key drift → local-node + name fallback in RUNTIME's getLocalSet; port contention → first-free bind + plugin scans range.
