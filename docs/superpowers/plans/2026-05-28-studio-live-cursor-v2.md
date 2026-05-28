# Studio Live Cursor v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Studio's generation feel alive by streaming Claude CLI's partial-message events into a code panel, narration ticker, and post-render edit cursor — replacing the broken 0.24.x implementation that only fired at the end of generation.

**Architecture:** Add `--include-partial-messages` to the claude CLI subprocess, parse new `content_block_start` / `content_block_delta` (`input_json_delta`) / `content_block_stop` events into three new `StudioEvent` kinds (`tool_call_started`, `tool_input_partial`, `tool_input_complete`), thread an `activeWrites` slice through `chatStreamReducer`, and render three independent visual layers: `<NarrationTicker>` (always-on bottom strip), `<CodeStreamPanel>` (mounted in `FrameCard` during a Write/Edit), and `<EditCursor>` (post-iframe-load pointer for follow-up Edits). Retire `<LiveCursorLayer>` and `<FrameSkeleton>`.

**Tech Stack:** TypeScript, React 19, Vitest, jsdom, Vite. Server: Node + child_process spawning the `claude` CLI. Tokens: arcade-gen `@xorkavi/arcade-gen` + studio `studio.css`.

---

## File Structure

**New files:**
- `studio/src/components/viewport/CodeStreamPanel.tsx` — partial code panel mounted inside `FrameCard`
- `studio/src/components/viewport/NarrationTicker.tsx` — bottom-of-viewport status strip
- `studio/src/components/viewport/EditCursor.tsx` — pointer sprite for post-render edits
- `studio/src/components/viewport/PhantomSkeleton.tsx` — replaces `FrameSkeleton`, brighter contrast
- `studio/__tests__/lib/streamJson-partials.test.ts`
- `studio/__tests__/hooks/chatStreamReducer-partials.test.ts`
- `studio/__tests__/components/code-stream-panel.test.tsx`
- `studio/__tests__/components/narration-ticker.test.tsx`
- `studio/__tests__/components/edit-cursor.test.tsx`
- `studio/__tests__/components/phantom-skeleton.test.tsx`
- `studio/__tests__/components/viewport-partials.test.tsx`
- `studio/__tests__/server/relay-partials.test.ts`

**Modified files:**
- `studio/server/claudeCode.ts` — add `--include-partial-messages` flag
- `studio/src/lib/streamJson.ts` — handle `stream_event` lines, emit new events
- `studio/src/hooks/chatStreamReducer.ts` — `activeWrites` slice + new reducer branches
- `studio/src/components/viewport/Viewport.tsx` — wire new components, drop `LiveCursorLayer`
- `studio/src/components/viewport/FrameCard.tsx` — accept `activeWrites`, mount `CodeStreamPanel`, plumb `onIframeLoad(slug)` callback
- `studio/src/styles/studio.css` — add `--surface-overlay-strong` token + ticker keyframe

**Retired files:**
- `studio/src/components/viewport/LiveCursorLayer.tsx` (delete)
- `studio/src/components/viewport/FrameSkeleton.tsx` (rename + rewrite as `PhantomSkeleton.tsx`)
- `studio/__tests__/components/live-cursor-layer.test.tsx` (delete)
- `studio/__tests__/components/frame-skeleton.test.tsx` (delete; replaced by phantom-skeleton.test.tsx)

---

## Task 1: Add `--include-partial-messages` flag to claude subprocess

**Files:**
- Modify: `studio/server/claudeCode.ts`
- Test: `studio/__tests__/server/claude-code-args.test.ts` (new, if not present; otherwise add a case to existing args test)

- [ ] **Step 1: Find the existing args test**

```bash
grep -rn "include-partial-messages\|stream-json\|args.push" studio/__tests__/server/ | head -20
ls studio/__tests__/server/ | grep -i claude
```

Expected: identifies which test file (if any) covers `claudeCode.ts` arg construction. If none exists, create `studio/__tests__/server/claude-code-args.test.ts`.

- [ ] **Step 2: Write failing test**

If a test file already covers claudeCode args, add a case asserting `--include-partial-messages` is in the spawn args. Otherwise create:

```ts
// studio/__tests__/server/claude-code-args.test.ts
import { describe, it, expect, vi } from "vitest";
import { spawn } from "child_process";

vi.mock("child_process", () => ({ spawn: vi.fn(() => ({
  stdout: { on: vi.fn() }, stderr: { on: vi.fn() },
  on: vi.fn(), kill: vi.fn(),
})) }));

import { runClaudeCli } from "../../server/claudeCode";

describe("runClaudeCli args", () => {
  it("passes --include-partial-messages so we get content_block_delta events", async () => {
    const promise = runClaudeCli({
      bin: "/usr/local/bin/claude",
      cwd: "/tmp",
      prompt: "hi",
      onLine: () => {},
    });
    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(args).toContain("--include-partial-messages");
    // Don't await — process never resolves under mock.
    void promise;
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm run studio:test studio/__tests__/server/claude-code-args.test.ts
```

Expected: FAIL — args don't include `--include-partial-messages`.

- [ ] **Step 4: Add the flag**

In `studio/server/claudeCode.ts`, find the `const args = [...]` array (around line 130) and add `"--include-partial-messages"` after `"--verbose"`:

```ts
const args = [
  "-p", decoratePrompt(opts.prompt, opts.images),
  "--output-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--bare",
  "--settings", settings,
  "--dangerously-skip-permissions",
  "--allowed-tools", DEFAULT_ALLOWED_TOOLS,
  "--disallowed-tools", DEFAULT_DISALLOWED_TOOLS,
  "--add-dir", opts.cwd,
];
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm run studio:test studio/__tests__/server/claude-code-args.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full server suite to confirm no regressions**

```bash
pnpm run studio:test studio/__tests__/server/
```

Expected: all server tests PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/server/claudeCode.ts studio/__tests__/server/claude-code-args.test.ts
git commit -m "feat(studio/live-cursor): pass --include-partial-messages to claude CLI

Enables content_block_delta events with input_json_delta chunks so the
parser can stream tool input character-by-character. Required by the v2
live-cursor pipeline."
```

---

## Task 2: Extend `StudioEvent` union with three new event types

**Files:**
- Modify: `studio/src/lib/streamJson.ts:3-33`

This task only adds the type definitions. Parser branches that emit them come in Task 3.

- [ ] **Step 1: Read the current type**

```bash
sed -n '3,33p' studio/src/lib/streamJson.ts
```

Confirm the discriminated union shape.

- [ ] **Step 2: Extend the type**

In `studio/src/lib/streamJson.ts`, replace the `StudioEvent` union with:

```ts
export type StudioEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "origin"; source: "claude" | "computer" }
  | { kind: "narration"; text: string }
  | {
      kind: "tool_call";
      tool: string;
      pretty: string;
      details?: string;
    }
  | {
      kind: "tool_call_started";
      toolUseId: string;
      tool: string;
      pretty: string;
    }
  | {
      kind: "tool_input_partial";
      toolUseId: string;
      action: "writing" | "editing";
      filePath?: string;
      partialContent: string;
    }
  | {
      kind: "tool_input_complete";
      toolUseId: string;
    }
  | {
      kind: "tool_result";
      tool: string;
      ok: boolean;
      snippet?: string;
    }
  | {
      kind: "agent_cursor";
      frame: string | null;
      action: "reading" | "writing" | "editing" | "thinking";
      filePath?: string;
      composites?: string[];
    }
  | { kind: "end"; ok: true }
  | { kind: "end"; ok: false; error: string; cancelled?: boolean };
```

- [ ] **Step 3: Run typecheck and tests to confirm union extension is non-breaking**

```bash
pnpm exec tsc -p studio/tsconfig.json --noEmit
pnpm run studio:test studio/__tests__/lib/streamJson.test.ts
```

Expected: typecheck PASS, existing parser tests PASS. New variants are unused so far.

- [ ] **Step 4: Commit**

```bash
git add studio/src/lib/streamJson.ts
git commit -m "feat(studio/live-cursor): add tool_call_started/partial/complete to StudioEvent

Type-only change. Parser branches that emit these events come next.
Discriminated union stays exhaustive via existing 'kind' switches."
```

---

## Task 3: Parse `stream_event` lines and emit new events

**Files:**
- Modify: `studio/src/lib/streamJson.ts` (add new top-level branch in `parseStreamLineAll`)
- Test: `studio/__tests__/lib/streamJson-partials.test.ts` (new)

The parser needs an internal buffer keyed by the content-block index so it can accumulate `partial_json` chunks across multiple deltas. Buffer is module-level (one Studio process = one claude subprocess at a time per turn — safe).

- [ ] **Step 1: Write failing test for content_block_start**

Create `studio/__tests__/lib/streamJson-partials.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { parseStreamLineAll, _resetPartialBuffer } from "../../src/lib/streamJson";

describe("parseStreamLineAll — partial messages", () => {
  beforeEach(() => _resetPartialBuffer());

  it("emits tool_call_started on content_block_start with tool_use", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_X", name: "Write", input: {} },
      },
    });
    const events = parseStreamLineAll(line);
    expect(events).toEqual([
      { kind: "tool_call_started", toolUseId: "toolu_X", tool: "Write", pretty: "Writing a file" },
    ]);
  });

  it("ignores content_block_start with thinking type", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
    });
    expect(parseStreamLineAll(line)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run studio:test studio/__tests__/lib/streamJson-partials.test.ts
```

Expected: FAIL — `_resetPartialBuffer` undefined, no `stream_event` handling.

- [ ] **Step 3: Implement minimal handler for content_block_start**

In `studio/src/lib/streamJson.ts`, add at the top-level (above `parseStreamLine`):

```ts
type PartialBufferEntry = {
  toolUseId: string;
  toolName: string;
  buffer: string;
};
const partialBuffers = new Map<number, PartialBufferEntry>();

export function _resetPartialBuffer(): void {
  partialBuffers.clear();
}
```

In `parseStreamLineAll`, after the existing `if (ev.type === "system" && ...)` block, add:

```ts
if (ev.type === "stream_event" && ev.event) {
  const e = ev.event;
  if (e.type === "content_block_start" && e.content_block?.type === "tool_use") {
    const toolUseId = String(e.content_block.id ?? "");
    const toolName = String(e.content_block.name ?? "");
    partialBuffers.set(Number(e.index), { toolUseId, toolName, buffer: "" });
    const pretty = prettyTool(toolName, {}).pretty;
    return [{ kind: "tool_call_started", toolUseId, tool: toolName, pretty }];
  }
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm run studio:test studio/__tests__/lib/streamJson-partials.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add test for input_json_delta extraction (Write)**

Append to `streamJson-partials.test.ts`:

```ts
it("emits tool_input_partial extracting partial content from Write deltas", () => {
  const start = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_W", name: "Write", input: {} },
    },
  });
  parseStreamLineAll(start);

  const delta1 = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"file_path":"/x/frames/hero/index.tsx","conten' },
    },
  });
  const delta2 = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: 't":"impo' },
    },
  });
  const delta3 = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: 'rt React' },
    },
  });

  const e1 = parseStreamLineAll(delta1);
  expect(e1).toEqual([
    {
      kind: "tool_input_partial",
      toolUseId: "toolu_W",
      action: "writing",
      filePath: "/x/frames/hero/index.tsx",
      partialContent: "",
    },
  ]);

  const e2 = parseStreamLineAll(delta2);
  expect(e2[0]).toMatchObject({
    kind: "tool_input_partial",
    toolUseId: "toolu_W",
    action: "writing",
    filePath: "/x/frames/hero/index.tsx",
    partialContent: "impo",
  });

  const e3 = parseStreamLineAll(delta3);
  expect(e3[0]).toMatchObject({
    kind: "tool_input_partial",
    partialContent: "import React",
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm run studio:test studio/__tests__/lib/streamJson-partials.test.ts
```

Expected: FAIL — delta handler not implemented.

- [ ] **Step 7: Implement input_json_delta handler**

In `streamJson.ts`, extend the `stream_event` branch:

```ts
if (ev.type === "stream_event" && ev.event) {
  const e = ev.event;
  if (e.type === "content_block_start" && e.content_block?.type === "tool_use") {
    const toolUseId = String(e.content_block.id ?? "");
    const toolName = String(e.content_block.name ?? "");
    partialBuffers.set(Number(e.index), { toolUseId, toolName, buffer: "" });
    const pretty = prettyTool(toolName, {}).pretty;
    return [{ kind: "tool_call_started", toolUseId, tool: toolName, pretty }];
  }
  if (e.type === "content_block_delta" && e.delta?.type === "input_json_delta") {
    const entry = partialBuffers.get(Number(e.index));
    if (!entry) return [];
    entry.buffer += String(e.delta.partial_json ?? "");
    if (entry.toolName !== "Write" && entry.toolName !== "Edit") return [];
    const action: "writing" | "editing" = entry.toolName === "Write" ? "writing" : "editing";
    const filePath = extractStringField(entry.buffer, "file_path");
    const contentField = entry.toolName === "Write" ? "content" : "new_string";
    const partialContent = extractStringField(entry.buffer, contentField, /*allowOpen*/ true) ?? "";
    return [
      {
        kind: "tool_input_partial",
        toolUseId: entry.toolUseId,
        action,
        filePath,
        partialContent,
      },
    ];
  }
  return [];
}
```

Add the helper above `parseStreamLine`:

```ts
/**
 * Extract a string field's value from a possibly-incomplete JSON buffer.
 * The buffer might end mid-string ('"content":"impo'), mid-escape, or
 * before the field even appears. Returns the unescaped value, or undefined
 * if the field hasn't been opened yet.
 *
 * `allowOpen` true → return whatever has been captured so far even when
 * the closing quote isn't present (used for content/new_string streams).
 * `allowOpen` false → only return on a complete "key":"value" pair.
 */
function extractStringField(
  buffer: string,
  fieldName: string,
  allowOpen = false,
): string | undefined {
  const opener = `"${fieldName}":"`;
  const start = buffer.indexOf(opener);
  if (start === -1) return undefined;
  const valueStart = start + opener.length;
  let i = valueStart;
  let result = "";
  while (i < buffer.length) {
    const ch = buffer[i];
    if (ch === "\\") {
      const next = buffer[i + 1];
      if (next === undefined) {
        return allowOpen ? result : undefined;
      }
      if (next === "n") result += "\n";
      else if (next === "r") result += "\r";
      else if (next === "t") result += "\t";
      else if (next === '"') result += '"';
      else if (next === "\\") result += "\\";
      else if (next === "/") result += "/";
      else if (next === "u") {
        const hex = buffer.slice(i + 2, i + 6);
        if (hex.length < 4) return allowOpen ? result : undefined;
        result += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        result += next;
      }
      i += 2;
      continue;
    }
    if (ch === '"') {
      return result;
    }
    result += ch;
    i += 1;
  }
  return allowOpen ? result : undefined;
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
pnpm run studio:test studio/__tests__/lib/streamJson-partials.test.ts
```

Expected: PASS.

- [ ] **Step 9: Add test for content_block_stop**

Append:

```ts
it("emits tool_input_complete + legacy tool_call + agent_cursor on content_block_stop", () => {
  const start = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_S", name: "Write", input: {} },
    },
  });
  parseStreamLineAll(start);

  const delta = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"file_path":"/x/frames/hero/index.tsx","content":"hi"}' },
    },
  });
  parseStreamLineAll(delta);

  const stop = JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_stop", index: 1 },
  });
  const events = parseStreamLineAll(stop);

  expect(events.find((e) => e.kind === "tool_input_complete")).toEqual({
    kind: "tool_input_complete",
    toolUseId: "toolu_S",
  });
  expect(events.find((e) => e.kind === "tool_call")).toMatchObject({
    kind: "tool_call",
    tool: "Write",
  });
  expect(events.find((e) => e.kind === "agent_cursor")).toMatchObject({
    kind: "agent_cursor",
    action: "writing",
    filePath: "/x/frames/hero/index.tsx",
  });
});

it("ignores signature_delta and text_delta in v1", () => {
  const sig = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "abc" },
    },
  });
  expect(parseStreamLineAll(sig)).toEqual([]);
});

it("emits no tool_input_partial for Bash deltas", () => {
  const start = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_B", name: "Bash", input: {} },
    },
  });
  parseStreamLineAll(start);

  const delta = JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
    },
  });
  expect(parseStreamLineAll(delta)).toEqual([]);
});
```

- [ ] **Step 10: Run tests; expect failures for stop handling**

```bash
pnpm run studio:test studio/__tests__/lib/streamJson-partials.test.ts
```

Expected: FAIL on stop test (no completion logic yet); the signature_delta and Bash tests should already pass (they fall through the existing branches).

- [ ] **Step 11: Implement content_block_stop handler**

Extend the stream_event branch:

```ts
if (e.type === "content_block_stop") {
  const entry = partialBuffers.get(Number(e.index));
  if (!entry) return [];
  partialBuffers.delete(Number(e.index));
  if (entry.toolName !== "Write" && entry.toolName !== "Edit") return [];
  let parsed: any = {};
  try {
    parsed = JSON.parse(entry.buffer);
  } catch {
    parsed = {};
  }
  const out: StudioEvent[] = [
    { kind: "tool_input_complete", toolUseId: entry.toolUseId },
  ];
  const pr = prettyTool(entry.toolName, parsed);
  out.push({ kind: "tool_call", ...pr });
  out.push(toolUseToCursor(entry.toolName, parsed));
  return out;
}
```

- [ ] **Step 12: Run all partial tests; expect PASS**

```bash
pnpm run studio:test studio/__tests__/lib/streamJson-partials.test.ts
```

Expected: PASS.

- [ ] **Step 13: Run the existing parser test to confirm no regression**

```bash
pnpm run studio:test studio/__tests__/lib/streamJson.test.ts
```

Expected: PASS — old `assistant`/`user`/`result` event handling untouched.

- [ ] **Step 14: Commit**

```bash
git add studio/src/lib/streamJson.ts studio/__tests__/lib/streamJson-partials.test.ts
git commit -m "feat(studio/live-cursor): parse stream_event lines into partial events

Adds parseStreamLineAll handlers for content_block_start /
content_block_delta (input_json_delta) / content_block_stop. Buffers
partial_json by index and regex-extracts file_path + content fields
even from incomplete JSON. Emits tool_call_started/partial/complete
plus existing tool_call + agent_cursor on stop for back-compat."
```

---

## Task 4: Add `activeWrites` slice to chatStreamReducer

**Files:**
- Modify: `studio/src/hooks/chatStreamReducer.ts`
- Test: `studio/__tests__/hooks/chatStreamReducer-partials.test.ts` (new)

- [ ] **Step 1: Write failing test for tool_call_started seeding**

Create `studio/__tests__/hooks/chatStreamReducer-partials.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyStudioEvent, INITIAL_STREAM_STATE } from "../../src/hooks/chatStreamReducer";

const FRAMES = [{ slug: "hero" }, { slug: "footer" }];

describe("chatStreamReducer — activeWrites", () => {
  it("seeds activeWrites entry when tool_call_started Write targets a frame", () => {
    const s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "tool_call_started",
      toolUseId: "toolu_X",
      tool: "Write",
      pretty: "Writing a file",
    }, FRAMES);
    // Started, but filePath unknown → no entry yet.
    expect(s.activeWrites).toEqual({});
  });

  it("creates entry when tool_input_partial arrives with frame filePath", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "tool_call_started",
      toolUseId: "toolu_X",
      tool: "Write",
      pretty: "Writing",
    }, FRAMES);
    s = applyStudioEvent(s, {
      kind: "tool_input_partial",
      toolUseId: "toolu_X",
      action: "writing",
      filePath: "/projects/p/frames/hero/index.tsx",
      partialContent: "import React",
    }, FRAMES);
    expect(s.activeWrites["toolu_X"]).toEqual({
      slug: "hero",
      filePath: "/projects/p/frames/hero/index.tsx",
      partialContent: "import React",
      startedAt: expect.any(Number),
    });
  });

  it("updates partialContent on subsequent partials", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "tool_call_started",
      toolUseId: "toolu_X",
      tool: "Write",
      pretty: "Writing",
    }, FRAMES);
    s = applyStudioEvent(s, {
      kind: "tool_input_partial",
      toolUseId: "toolu_X",
      action: "writing",
      filePath: "/projects/p/frames/hero/index.tsx",
      partialContent: "import",
    }, FRAMES);
    s = applyStudioEvent(s, {
      kind: "tool_input_partial",
      toolUseId: "toolu_X",
      action: "writing",
      filePath: "/projects/p/frames/hero/index.tsx",
      partialContent: "import React",
    }, FRAMES);
    expect(s.activeWrites["toolu_X"].partialContent).toBe("import React");
  });

  it("removes entry on tool_input_complete", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "tool_call_started",
      toolUseId: "toolu_X",
      tool: "Write",
      pretty: "Writing",
    }, FRAMES);
    s = applyStudioEvent(s, {
      kind: "tool_input_partial",
      toolUseId: "toolu_X",
      action: "writing",
      filePath: "/projects/p/frames/hero/index.tsx",
      partialContent: "import",
    }, FRAMES);
    s = applyStudioEvent(s, {
      kind: "tool_input_complete",
      toolUseId: "toolu_X",
    }, FRAMES);
    expect(s.activeWrites).toEqual({});
  });

  it("clears activeWrites when turn ends with cancelled", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "tool_call_started",
      toolUseId: "toolu_X",
      tool: "Write",
      pretty: "Writing",
    }, FRAMES);
    s = applyStudioEvent(s, {
      kind: "tool_input_partial",
      toolUseId: "toolu_X",
      action: "writing",
      filePath: "/projects/p/frames/hero/index.tsx",
      partialContent: "import",
    }, FRAMES);
    s = applyStudioEvent(s, {
      kind: "end",
      ok: false,
      error: "user cancelled",
      cancelled: true,
    }, FRAMES);
    expect(s.activeWrites).toEqual({});
  });

  it("ignores partials for filePaths outside any known frame", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "tool_call_started",
      toolUseId: "toolu_Y",
      tool: "Write",
      pretty: "Writing",
    }, FRAMES);
    s = applyStudioEvent(s, {
      kind: "tool_input_partial",
      toolUseId: "toolu_Y",
      action: "writing",
      filePath: "/projects/p/CLAUDE.md",
      partialContent: "hello",
    }, FRAMES);
    expect(s.activeWrites).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run studio:test studio/__tests__/hooks/chatStreamReducer-partials.test.ts
```

Expected: FAIL — `applyStudioEvent` doesn't accept frames arg, doesn't have `activeWrites` slice.

- [ ] **Step 3: Update reducer to accept frames + add activeWrites**

In `studio/src/hooks/chatStreamReducer.ts`:

1. Extend `StreamState`:

```ts
export interface StreamState {
  busy: boolean;
  phase: TurnPhase;
  error: string | null;
  errorKind?: ErrorKind;
  narrations: string[];
  items: ChatTurnItem[];
  lastEvent: StudioEvent | null;
  lastPrompt: string;
  source: "claude" | "computer";
  turnStartedAt: number | null;
  turnEndedAt: number | null;
  agentCursor: {
    frame: string | null;
    action: "reading" | "writing" | "editing" | "thinking";
    filePath?: string;
    composites: string[];
    narration?: string;
    updatedAt: number;
  } | null;
  activeWrites: Record<string, {
    slug: string;
    filePath: string;
    partialContent: string;
    startedAt: number;
  }>;
}
```

2. Update `INITIAL_STREAM_STATE` to include `activeWrites: {}`.

3. Change the signature:

```ts
import { mapPathToFrame } from "../lib/agentCursor";

export function applyStudioEvent(
  s: StreamState,
  ev: StudioEvent,
  frames: ReadonlyArray<{ slug: string }> = [],
): StreamState {
  // … existing branches …
}
```

4. Add new branches before the catch-all `return { ...s, lastEvent: ev };`:

```ts
if (ev.kind === "tool_call_started") {
  // No-op until we know the filePath. Recorded only via lastEvent for debug.
  return { ...s, lastEvent: ev };
}
if (ev.kind === "tool_input_partial") {
  const slug = ev.filePath ? mapPathToFrame(ev.filePath, frames) : null;
  if (!slug) {
    // Path outside frames or unknown — drop.
    return { ...s, lastEvent: ev };
  }
  const existing = s.activeWrites[ev.toolUseId];
  return {
    ...s,
    lastEvent: ev,
    activeWrites: {
      ...s.activeWrites,
      [ev.toolUseId]: {
        slug,
        filePath: ev.filePath!,
        partialContent: ev.partialContent,
        startedAt: existing?.startedAt ?? Date.now(),
      },
    },
  };
}
if (ev.kind === "tool_input_complete") {
  if (!(ev.toolUseId in s.activeWrites)) {
    return { ...s, lastEvent: ev };
  }
  const next = { ...s.activeWrites };
  delete next[ev.toolUseId];
  return { ...s, lastEvent: ev, activeWrites: next };
}
```

5. In every existing `if (ev.kind === "end")` branch (success / cancelled / error), add `activeWrites: {}` to the returned state.

- [ ] **Step 4: Run reducer test to verify it passes**

```bash
pnpm run studio:test studio/__tests__/hooks/chatStreamReducer-partials.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update existing reducer tests + callers for new signature**

```bash
grep -rn "applyStudioEvent\b" studio/src studio/__tests__ | head -40
```

For each call site, add `, frames` as third argument (or `, []` if frames not in scope).

Files likely affected:
- `studio/src/hooks/useChatStream.ts`
- `studio/src/hooks/useProjectFromHost.ts`
- `studio/src/hooks/useProjectFromMirror.ts`
- `studio/__tests__/hooks/chatStreamReducer.test.ts` (existing)

In each `apply` call inside the hooks, pass `frames` from the closure (the hooks already have access to frames via `useFrames` or props).

- [ ] **Step 6: Run full reducer + hook tests**

```bash
pnpm run studio:test studio/__tests__/hooks/
```

Expected: PASS.

- [ ] **Step 7: Run full suite**

```bash
pnpm run studio:test
```

Expected: PASS (excluding the known-flaky `tunnelRendezvous.test.ts` if it appears).

- [ ] **Step 8: Commit**

```bash
git add studio/src/hooks/chatStreamReducer.ts studio/src/hooks/useChatStream.ts \
        studio/src/hooks/useProjectFromHost.ts studio/src/hooks/useProjectFromMirror.ts \
        studio/__tests__/hooks/chatStreamReducer-partials.test.ts \
        studio/__tests__/hooks/chatStreamReducer.test.ts
git commit -m "feat(studio/live-cursor): track activeWrites in chatStreamReducer

Adds activeWrites slice keyed by toolUseId. Seeded on first
tool_input_partial with a frame-resolvable filePath, updated on each
partial, dropped on tool_input_complete or turn end. applyStudioEvent
now takes frames as a third arg so mapPathToFrame can resolve slugs
inside the reducer."
```

---

## Task 5: Add `--surface-overlay-strong` token to studio.css

**Files:**
- Modify: `studio/src/styles/studio.css`

- [ ] **Step 1: Add the token**

Append to the top of `studio/src/styles/studio.css` (after the existing `:root { color-scheme: light dark; }`):

```css
/* Brighter surface for live skeleton blocks during generation. The base
 * --surface-overlay token from arcade-gen sits too close to the viewport
 * background to be visible while pulsing. We define a sibling here only
 * for the PhantomSkeleton component. */
:root {
  --surface-overlay-strong: rgba(120, 120, 140, 0.18);
}
@media (prefers-color-scheme: dark) {
  :root {
    --surface-overlay-strong: rgba(255, 255, 255, 0.12);
  }
}

/* PhantomSkeleton block pulse — alternates between overlay and
 * overlay-strong so blocks remain visible against either viewport bg. */
@keyframes arcade-studio-phantom-pulse {
  0%, 100% { background: var(--surface-overlay); }
  50%      { background: var(--surface-overlay-strong); }
}
```

- [ ] **Step 2: Verify CSS still parses by starting dev server briefly**

```bash
timeout 10 pnpm run studio 2>&1 | head -20 || true
```

Expected: no CSS parse errors logged. (Server may not fully start in 10s; we're only checking startup error output.)

- [ ] **Step 3: Commit**

```bash
git add studio/src/styles/studio.css
git commit -m "feat(studio/live-cursor): add --surface-overlay-strong + phantom pulse keyframe

Brighter token + dedicated keyframe for PhantomSkeleton blocks so they
stay visible against the viewport background regardless of theme."
```

---

## Task 6: Build `<PhantomSkeleton>` component (replaces FrameSkeleton)

**Files:**
- Create: `studio/src/components/viewport/PhantomSkeleton.tsx`
- Create: `studio/__tests__/components/phantom-skeleton.test.tsx`
- Delete: `studio/src/components/viewport/FrameSkeleton.tsx` (after migration in Task 8)
- Delete: `studio/__tests__/components/frame-skeleton.test.tsx` (after migration in Task 8)

- [ ] **Step 1: Write failing test**

Create `studio/__tests__/components/phantom-skeleton.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhantomSkeleton } from "../../src/components/viewport/PhantomSkeleton";

describe("PhantomSkeleton", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(
      <PhantomSkeleton visible={false} composites={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders fallback shapes when no composites known", () => {
    render(<PhantomSkeleton visible={true} composites={[]} />);
    const root = screen.getByTestId("phantom-skeleton");
    expect(root).toBeInTheDocument();
    // Fallback uses 4 default blocks.
    expect(root.querySelectorAll("[data-skeleton-block]")).toHaveLength(4);
  });

  it("uses arcade-studio-phantom-pulse animation", () => {
    render(<PhantomSkeleton visible={true} composites={[]} />);
    const block = screen
      .getByTestId("phantom-skeleton")
      .querySelector<HTMLDivElement>("[data-skeleton-block]")!;
    expect(block.style.animation).toContain("arcade-studio-phantom-pulse");
  });

  it("renders Hero block when composite known", () => {
    render(<PhantomSkeleton visible={true} composites={["Hero"]} />);
    const root = screen.getByTestId("phantom-skeleton");
    expect(
      root.querySelector('[data-skeleton-block="Hero"]'),
    ).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run studio:test studio/__tests__/components/phantom-skeleton.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `studio/src/components/viewport/PhantomSkeleton.tsx`:

```tsx
import { SHAPES, type SkeletonShape } from "./skeletonShapes";

const FALLBACK: Array<{ name: string; shape: SkeletonShape }> = [
  { name: "Header", shape: SHAPES.Header },
  { name: "block-a", shape: { kind: "block", height: "30%" } },
  { name: "block-b", shape: { kind: "block", height: "30%" } },
  { name: "Footer", shape: SHAPES.Footer },
];

function blockStyle(index: number): React.CSSProperties {
  return {
    background: "var(--surface-overlay)",
    borderRadius: 8,
    animation: "arcade-studio-phantom-pulse 1.6s ease-in-out infinite alternate",
    animationDelay: `${index * 200}ms`,
  };
}

export function PhantomSkeleton({
  composites,
  visible,
}: {
  composites: string[];
  visible: boolean;
}) {
  if (!visible) return null;

  const known = composites
    .map((name) => ({ name, shape: SHAPES[name] }))
    .filter((entry): entry is { name: string; shape: SkeletonShape } => Boolean(entry.shape));

  const entries = known.length > 0 ? known : FALLBACK;

  const top = entries.filter((e) => e.shape.kind === "bar" && (e.shape as any).anchor === "top");
  const bottom = entries.filter((e) => e.shape.kind === "bar" && (e.shape as any).anchor === "bottom");
  const left = entries.filter((e) => e.shape.kind === "rail" && (e.shape as any).anchor === "left");
  const right = entries.filter((e) => e.shape.kind === "rail" && (e.shape as any).anchor === "right");
  const center = entries.filter((e) =>
    e.shape.kind !== "bar" && e.shape.kind !== "rail",
  );

  let blockIndex = 0;

  return (
    <div
      data-testid="phantom-skeleton"
      style={{
        position: "absolute",
        inset: 0,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        pointerEvents: "none",
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 12,
        background: "var(--surface-overlay)",
      }}
      aria-hidden="true"
    >
      {top.map((e, i) => (
        <div
          key={`top-${e.name}-${i}`}
          data-skeleton-block={e.name}
          style={{ ...blockStyle(blockIndex++), height: (e.shape as any).height }}
        />
      ))}
      <div style={{ flex: 1, display: "flex", gap: 16 }}>
        {left.map((e, i) => (
          <div
            key={`left-${e.name}-${i}`}
            data-skeleton-block={e.name}
            style={{ ...blockStyle(blockIndex++), width: (e.shape as any).width }}
          />
        ))}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {center.flatMap((e, i) => {
            if (e.shape.kind === "tile") {
              const tiles = Array.from({ length: e.shape.repeat }).map((_, j) => (
                <div
                  key={`tile-${e.name}-${i}-${j}`}
                  data-skeleton-block={e.name}
                  style={{
                    ...blockStyle(blockIndex++),
                    aspectRatio: e.shape.aspect,
                    flex: 1,
                  }}
                />
              ));
              return [
                <div
                  key={`tile-row-${i}`}
                  style={{ display: "flex", gap: 16, flex: 1 }}
                >
                  {tiles}
                </div>,
              ];
            }
            if (e.shape.kind === "centered") {
              return [
                <div
                  key={`center-${e.name}-${i}`}
                  data-skeleton-block={e.name}
                  style={{
                    ...blockStyle(blockIndex++),
                    width: e.shape.width,
                    height: e.shape.height,
                    alignSelf: "center",
                    margin: "auto",
                  }}
                />,
              ];
            }
            return [
              <div
                key={`block-${e.name}-${i}`}
                data-skeleton-block={e.name}
                style={{ ...blockStyle(blockIndex++), height: (e.shape as any).height ?? "100%" }}
              />,
            ];
          })}
        </div>
        {right.map((e, i) => (
          <div
            key={`right-${e.name}-${i}`}
            data-skeleton-block={e.name}
            style={{ ...blockStyle(blockIndex++), width: (e.shape as any).width }}
          />
        ))}
      </div>
      {bottom.map((e, i) => (
        <div
          key={`bottom-${e.name}-${i}`}
          data-skeleton-block={e.name}
          style={{ ...blockStyle(blockIndex++), height: (e.shape as any).height }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm run studio:test studio/__tests__/components/phantom-skeleton.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/viewport/PhantomSkeleton.tsx \
        studio/__tests__/components/phantom-skeleton.test.tsx
git commit -m "feat(studio/live-cursor): PhantomSkeleton with bright pulse + outer card

Replaces FrameSkeleton's transparent blocks (--surface-overlay-2 fallback
that wasn't visible against viewport bg) with an animated card that has
a visible outer border, 12px radius, and pulses between two solid token
values. Same SHAPES catalog and composite-detection behaviour."
```

---

## Task 7: Build `<NarrationTicker>` component

**Files:**
- Create: `studio/src/components/viewport/NarrationTicker.tsx`
- Create: `studio/__tests__/components/narration-ticker.test.tsx`

- [ ] **Step 1: Write failing test**

Create `studio/__tests__/components/narration-ticker.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NarrationTicker } from "../../src/components/viewport/NarrationTicker";

describe("NarrationTicker", () => {
  it("hides when phase idle and no narrations", () => {
    const { container } = render(
      <NarrationTicker narrations={[]} lastTool={null} phase="idle" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows last 3 narrations newest at top", () => {
    render(
      <NarrationTicker
        narrations={["one", "two", "three", "four", "five"]}
        lastTool={null}
        phase="running"
      />,
    );
    const items = screen.getAllByTestId("narration-item");
    expect(items.map((el) => el.textContent)).toEqual(["five", "four", "three"]);
  });

  it("renders lastTool pretty string", () => {
    render(
      <NarrationTicker
        narrations={[]}
        lastTool={{ name: "Read", pretty: "Reading kit-manifest.md" }}
        phase="running"
      />,
    );
    expect(screen.getByText("Reading kit-manifest.md")).toBeInTheDocument();
  });

  it("fades older narrations", () => {
    render(
      <NarrationTicker
        narrations={["a", "b", "c"]}
        lastTool={null}
        phase="running"
      />,
    );
    const items = screen.getAllByTestId("narration-item");
    const opacities = items.map((el) => parseFloat(el.style.opacity));
    expect(opacities[0]).toBeGreaterThan(opacities[2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run studio:test studio/__tests__/components/narration-ticker.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `studio/src/components/viewport/NarrationTicker.tsx`:

```tsx
import type { TurnPhase } from "../../hooks/chatStreamReducer";

export function NarrationTicker({
  narrations,
  lastTool,
  phase,
}: {
  narrations: string[];
  lastTool: { name: string; pretty: string } | null;
  phase: TurnPhase;
}) {
  if (phase !== "running" && narrations.length === 0) return null;

  const recent = narrations.slice(-3).reverse();
  const total = recent.length;

  return (
    <div
      data-testid="narration-ticker"
      style={{
        position: "absolute",
        bottom: 24,
        left: 32,
        right: 32,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
        {recent.map((text, i) => {
          const opacity = total === 1 ? 0.85 : 0.85 - 0.3 * (i / (total - 1));
          return (
            <div
              key={i}
              data-testid="narration-item"
              title={text}
              style={{
                color: "var(--fg-neutral-medium)",
                fontSize: 12,
                opacity,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              }}
            >
              {text}
            </div>
          );
        })}
      </div>
      {lastTool && (
        <div
          data-testid="narration-tool"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--fg-neutral-tertiary)",
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <span style={{ animation: "arcade-studio-pulse 1.4s ease-in-out infinite" }}>•••</span>
          <span>{lastTool.pretty}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm run studio:test studio/__tests__/components/narration-ticker.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/viewport/NarrationTicker.tsx \
        studio/__tests__/components/narration-ticker.test.tsx
git commit -m "feat(studio/live-cursor): NarrationTicker bottom-of-viewport status strip

Last 3 narrations stacked newest-on-top with opacity fade, and the most
recent tool pretty-string with a pulsing dots indicator on the right.
Auto-hides when phase is idle and no narrations exist."
```

---

## Task 8: Build `<CodeStreamPanel>` component

**Files:**
- Create: `studio/src/components/viewport/CodeStreamPanel.tsx`
- Create: `studio/__tests__/components/code-stream-panel.test.tsx`

- [ ] **Step 1: Write failing test**

Create `studio/__tests__/components/code-stream-panel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CodeStreamPanel } from "../../src/components/viewport/CodeStreamPanel";

describe("CodeStreamPanel", () => {
  it("renders the partial content", () => {
    render(
      <CodeStreamPanel
        partial="import React from 'react';"
        filePath="/projects/p/frames/hero/index.tsx"
      />,
    );
    expect(
      screen.getByTestId("code-stream-panel").textContent,
    ).toContain("import React");
  });

  it("shows filename basename in header", () => {
    render(
      <CodeStreamPanel
        partial=""
        filePath="/projects/p/frames/hero/index.tsx"
      />,
    );
    expect(screen.getByTestId("code-stream-header").textContent).toContain("index.tsx");
  });

  it("shows char count in header", () => {
    render(
      <CodeStreamPanel
        partial="abcde"
        filePath="/projects/p/frames/hero/index.tsx"
      />,
    );
    expect(screen.getByTestId("code-stream-header").textContent).toContain("5 chars");
  });

  it("renders empty body for empty partial", () => {
    render(
      <CodeStreamPanel
        partial=""
        filePath="/projects/p/frames/hero/index.tsx"
      />,
    );
    expect(screen.getByTestId("code-stream-body").textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run studio:test studio/__tests__/components/code-stream-panel.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `studio/src/components/viewport/CodeStreamPanel.tsx`:

```tsx
import { useEffect, useRef } from "react";

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

export function CodeStreamPanel({
  partial,
  filePath,
}: {
  partial: string;
  filePath: string;
}) {
  const bodyRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [partial]);

  return (
    <div
      data-testid="code-stream-panel"
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--surface-overlay)",
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 2,
      }}
    >
      <div
        data-testid="code-stream-header"
        style={{
          padding: "8px 12px",
          fontSize: 12,
          color: "var(--fg-neutral-medium)",
          borderBottom: "1px solid var(--stroke-neutral-subtle)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
          {basename(filePath)}
        </span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ animation: "arcade-studio-pulse 1.4s ease-in-out infinite" }}>•</span>
          <span>Writing… {partial.length} chars</span>
        </span>
      </div>
      <pre
        ref={bodyRef}
        data-testid="code-stream-body"
        style={{
          margin: 0,
          padding: 12,
          flex: 1,
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--fg-neutral-primary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {partial}
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm run studio:test studio/__tests__/components/code-stream-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/viewport/CodeStreamPanel.tsx \
        studio/__tests__/components/code-stream-panel.test.tsx
git commit -m "feat(studio/live-cursor): CodeStreamPanel for partial Write content

Renders growing tool-input content as monospace preformatted text inside
the FrameCard's iframe wrapper. Auto-scrolls to bottom as content grows.
Header shows filename basename + char count + pulsing dot."
```

---

## Task 9: Build `<EditCursor>` component

**Files:**
- Create: `studio/src/components/viewport/EditCursor.tsx`
- Create: `studio/__tests__/components/edit-cursor.test.tsx`

- [ ] **Step 1: Write failing test**

Create `studio/__tests__/components/edit-cursor.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { EditCursor, _hashCoords } from "../../src/components/viewport/EditCursor";

const FRAMES = [{ slug: "hero" }, { slug: "footer" }];

function Wrapper(props: any) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      data-testid="container"
      style={{ position: "relative", width: 800, height: 600 }}
    >
      <div data-frame-slug="hero" style={{ width: 400, height: 300 }} />
      <EditCursor {...props} containerRef={ref} frames={FRAMES} />
    </div>
  );
}

describe("EditCursor", () => {
  it("renders nothing when agentCursor is null", () => {
    render(
      <Wrapper agentCursor={null} loadedSlugs={new Set(["hero"])} />,
    );
    expect(screen.queryByTestId("edit-cursor")).toBeNull();
  });

  it("renders nothing when action is not editing", () => {
    render(
      <Wrapper
        agentCursor={{
          frame: null,
          action: "writing",
          filePath: "/x/frames/hero/index.tsx",
          composites: [],
          updatedAt: 0,
        }}
        loadedSlugs={new Set(["hero"])}
      />,
    );
    expect(screen.queryByTestId("edit-cursor")).toBeNull();
  });

  it("renders nothing when slug not in loadedSlugs", () => {
    render(
      <Wrapper
        agentCursor={{
          frame: null,
          action: "editing",
          filePath: "/x/frames/hero/index.tsx",
          composites: [],
          updatedAt: 0,
        }}
        loadedSlugs={new Set()}
      />,
    );
    expect(screen.queryByTestId("edit-cursor")).toBeNull();
  });

  it("renders when editing AND slug loaded", () => {
    render(
      <Wrapper
        agentCursor={{
          frame: null,
          action: "editing",
          filePath: "/x/frames/hero/index.tsx",
          composites: [],
          updatedAt: 0,
        }}
        loadedSlugs={new Set(["hero"])}
      />,
    );
    expect(screen.getByTestId("edit-cursor")).toBeInTheDocument();
  });

  it("hashes deterministically", () => {
    expect(_hashCoords("foo", 100, 100)).toEqual(_hashCoords("foo", 100, 100));
    expect(_hashCoords("foo", 100, 100)).not.toEqual(_hashCoords("bar", 100, 100));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run studio:test studio/__tests__/components/edit-cursor.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `studio/src/components/viewport/EditCursor.tsx`:

```tsx
import { useEffect, useState, type RefObject } from "react";
import type { Frame } from "../../../server/types";
import type { StreamState } from "../../hooks/chatStreamReducer";
import { mapPathToFrame } from "../../lib/agentCursor";

const POINTER_SIZE = 18;

export function _hashCoords(seed: string, w: number, h: number): { x: number; y: number } {
  let h32 = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h32 = (h32 * 31 + seed.charCodeAt(i)) | 0;
  }
  const x = Math.abs(h32) % Math.max(1, Math.floor(w - POINTER_SIZE));
  const y = Math.abs(h32 >> 8) % Math.max(1, Math.floor(h - POINTER_SIZE));
  return { x, y };
}

export function EditCursor({
  agentCursor,
  containerRef,
  frames,
  loadedSlugs,
}: {
  agentCursor: StreamState["agentCursor"];
  containerRef: RefObject<HTMLDivElement>;
  frames: Frame[];
  loadedSlugs: ReadonlySet<string>;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const slug = agentCursor
    ? agentCursor.frame ?? mapPathToFrame(agentCursor.filePath ?? "", frames)
    : null;

  const shouldShow = Boolean(
    agentCursor && agentCursor.action === "editing" && slug && loadedSlugs.has(slug),
  );

  useEffect(() => {
    if (!shouldShow || !slug || !agentCursor) {
      setPos(null);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const cardEl = container.querySelector<HTMLElement>(`[data-frame-slug="${slug}"]`);
    if (!cardEl) return;
    const cardRect = cardEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const seed = (agentCursor.filePath ?? "") + (agentCursor.narration ?? "");
    const local = _hashCoords(seed.slice(0, 64), cardRect.width, cardRect.height);
    setPos({
      x: cardRect.left - containerRect.left + local.x,
      y: cardRect.top - containerRect.top + local.y,
    });
  }, [shouldShow, slug, agentCursor, containerRef]);

  if (!shouldShow || !pos) return null;

  return (
    <div
      data-testid="edit-cursor"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: POINTER_SIZE,
        height: POINTER_SIZE,
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        transition: "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <svg
        width={POINTER_SIZE}
        height={POINTER_SIZE}
        viewBox="0 0 18 18"
        aria-hidden="true"
        style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))" }}
      >
        <path
          d="M2 2 L2 14 L6 11 L9 16 L12 14 L9 9 L14 9 Z"
          fill="white"
          stroke="black"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm run studio:test studio/__tests__/components/edit-cursor.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/viewport/EditCursor.tsx \
        studio/__tests__/components/edit-cursor.test.tsx
git commit -m "feat(studio/live-cursor): EditCursor pointer for post-render edits

Renders only when agentCursor.action === 'editing' AND the resolved
frame slug is in loadedSlugs (so the iframe has loaded at least once).
Hashes (filePath + narration) into card-relative coords, hops between
positions with 250ms eased transform."
```

---

## Task 10: Wire new components into Viewport, retire LiveCursorLayer + FrameSkeleton

**Files:**
- Modify: `studio/src/components/viewport/Viewport.tsx`
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Delete: `studio/src/components/viewport/LiveCursorLayer.tsx`
- Delete: `studio/src/components/viewport/FrameSkeleton.tsx`
- Delete: `studio/__tests__/components/live-cursor-layer.test.tsx`
- Delete: `studio/__tests__/components/frame-skeleton.test.tsx`
- Test: `studio/__tests__/components/viewport-partials.test.tsx` (new)

- [ ] **Step 1: Write failing integration test**

Create `studio/__tests__/components/viewport-partials.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Viewport } from "../../src/components/viewport/Viewport";
import type { Project } from "../../server/types";

const project: Project = {
  slug: "p1",
  name: "P1",
  mode: "light",
  frames: [],
  createdAt: Date.now(),
} as any;

describe("Viewport — partial pipeline integration", () => {
  it("renders PhantomSkeleton + NarrationTicker when running with no frames", () => {
    render(
      <Viewport
        project={project}
        frameWidth={1024}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        agentCursor={null}
        phase="running"
        narrations={["Reading kit-manifest.md"]}
        activeWrites={{}}
      />,
    );
    expect(screen.getByTestId("phantom-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("narration-ticker")).toBeInTheDocument();
    expect(screen.queryByTestId("code-stream-panel")).toBeNull();
    expect(screen.queryByTestId("edit-cursor")).toBeNull();
  });

  it("does not render NarrationTicker on idle empty viewport", () => {
    render(
      <Viewport
        project={project}
        frameWidth={1024}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
        agentCursor={null}
        phase="idle"
        narrations={[]}
        activeWrites={{}}
      />,
    );
    expect(screen.queryByTestId("narration-ticker")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm run studio:test studio/__tests__/components/viewport-partials.test.tsx
```

Expected: FAIL — `activeWrites` prop not recognized; PhantomSkeleton not mounted.

- [ ] **Step 3: Update FrameCard signature for activeWrites + onIframeLoad callback**

Open `studio/src/components/viewport/FrameCard.tsx`. Replace the props interface and adjust:

1. Remove the `FrameSkeleton` import. Add `CodeStreamPanel`:

```ts
import { CodeStreamPanel } from "./CodeStreamPanel";
```

2. Add to props:

```ts
activeWrite?: { partialContent: string; filePath: string };
onIframeLoad?: (slug: string) => void;
```

3. Where the iframe `onLoad` runs, also call the new callback:

```tsx
function onIframeLoad() {
  if (props.onIframeLoad) props.onIframeLoad(frame.slug);
  if (phase !== "running") return;
  // … existing wipe logic stays …
}
```

4. Replace the existing `<FrameSkeleton ... />` line (currently at line 327 inside the wipe wrapper) with a conditional `<CodeStreamPanel>` mount:

```tsx
<div
  ref={wipeWrapperRef}
  onAnimationEnd={onWrapperAnimationEnd}
  style={{
    position: "absolute",
    inset: 0,
    background: "var(--surface-overlay)",
    border: "1px solid var(--stroke-neutral-subtle)",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: picking
      ? "inset 0 0 0 2px var(--component-button-primary-bg-idle)"
      : undefined,
    transition: "box-shadow 0.2s ease",
  }}
>
  <iframe
    ref={iframeRef}
    key={projectMode}
    title={frame.name}
    src={frameUrl}
    onLoad={onIframeLoad}
    style={{
      width: "100%",
      height: "100%",
      border: 0,
      pointerEvents: resizing ? "none" : "auto",
    }}
  />
  {activeWrite && (
    <CodeStreamPanel
      partial={activeWrite.partialContent}
      filePath={activeWrite.filePath}
    />
  )}
</div>
```

Drop unused state: `justWiped` is still used by the wipe; only the FrameSkeleton-related references go.

5. Remove `agentCursor`, `phase` prop processing that was for FrameSkeleton compositing — keep `phase` for the wipe gate and `agentCursor` is no longer read inside FrameCard. Delete the `resolvedSlug`/`isTargeted`/`composites` lines that powered the skeleton.

- [ ] **Step 4: Update Viewport to drive new layers**

Replace `studio/src/components/viewport/Viewport.tsx` body (preserving onMessage handlers) so it:

1. Imports the new components, drops `FrameSkeleton`/`LiveCursorLayer`:

```ts
import { useEffect, useState, useRef } from "react";
import type { Project } from "../../../server/types";
import { useFrames } from "../../hooks/useFrames";
import { FrameCard } from "./FrameCard";
import { EmptyViewport } from "./EmptyViewport";
import { ViewportPreview } from "./ViewportPreview";
import { NewFrameCard } from "./NewFrameCard";
import { api } from "../../lib/api";
import { PhantomSkeleton } from "./PhantomSkeleton";
import { NarrationTicker } from "./NarrationTicker";
import { EditCursor } from "./EditCursor";
import type { StreamState, TurnPhase } from "../../hooks/chatStreamReducer";
```

2. Adds props `activeWrites: StreamState["activeWrites"]` and `lastTool?: { name: string; pretty: string } | null` (derive `lastTool` in caller; pass null for now if unavailable).

3. Adds local state `loadedSlugs: ReadonlySet<string>` initialized via `useState(() => new Set<string>())` and an `onIframeLoad(slug)` setter that adds to the set.

4. Pulls per-card `activeWrite` by slug:

```tsx
const writesBySlug = useMemo(() => {
  const out: Record<string, { partialContent: string; filePath: string }> = {};
  for (const w of Object.values(activeWrites)) {
    out[w.slug] = { partialContent: w.partialContent, filePath: w.filePath };
  }
  return out;
}, [activeWrites]);
```

5. Empty-state branches:

```tsx
if (!frames.length) {
  if (isReadonly && phase !== "running") {
    return (
      <div style={emptyMessageStyle}>Waiting for the host to generate frames…</div>
    );
  }
  if (phase === "running") {
    const clampedWidth = Math.min(2560, Math.max(320, frameWidth));
    return (
      <ViewportPreview zoom={zoom} onZoomChange={onZoomChange}>
        <div ref={containerRef} style={runningContainerStyle}>
          <div style={{ flex: "none", width: clampedWidth, height: "calc(100vh - 180px)", position: "relative" }}>
            <PhantomSkeleton visible={true} composites={agentCursor?.composites ?? []} />
          </div>
          <NarrationTicker narrations={narrations} lastTool={lastTool ?? null} phase={phase} />
        </div>
      </ViewportPreview>
    );
  }
  if (!isReadonly) {
    return <EmptyViewport onCreateFrame={handleCreateFrame} busy={creatingFrame} />;
  }
  return <div style={emptyMessageStyle}>Waiting for the host to generate frames…</div>;
}
```

6. Populated-grid branch:

```tsx
return (
  <ViewportPreview zoom={zoom} onZoomChange={onZoomChange}>
    <div ref={containerRef} style={runningContainerStyle}>
      {frames.map((f) => (
        <FrameCard
          key={f.slug}
          projectSlug={project.slug}
          frame={f}
          frameWidth={frameWidth}
          onFrameWidthChange={onFrameWidthChange}
          projectMode={project.mode}
          zoom={zoom}
          highlighted={highlight?.slug === f.slug ? highlight.kind : null}
          readonly={isReadonly}
          srcOverride={frameSrcOverride}
          phase={phase}
          activeWrite={writesBySlug[f.slug]}
          onIframeLoad={(slug) =>
            setLoadedSlugs((prev) => {
              if (prev.has(slug)) return prev;
              const next = new Set(prev);
              next.add(slug);
              return next;
            })
          }
        />
      ))}
      {!isReadonly && <NewFrameCard onClick={handleCreateFrame} busy={creatingFrame} />}
      <EditCursor
        agentCursor={agentCursor}
        containerRef={containerRef}
        frames={frames}
        loadedSlugs={loadedSlugs}
      />
      <NarrationTicker narrations={narrations} lastTool={lastTool ?? null} phase={phase} />
    </div>
  </ViewportPreview>
);
```

Where `runningContainerStyle` and `emptyMessageStyle` are extracted from the existing inline styles in Viewport (no behavior change).

- [ ] **Step 5: Update Viewport prop types**

```ts
export function Viewport({
  project,
  frameWidth,
  onFrameWidthChange,
  zoom,
  onZoomChange,
  onSeedChat,
  readonly: isReadonly = false,
  frameSrcOverride,
  agentCursor = null,
  phase = "idle",
  narrations = [],
  activeWrites = {},
  lastTool = null,
}: {
  project: Project;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
  zoom: number;
  onZoomChange: (next: number) => void;
  onSeedChat: (text: string) => void;
  readonly?: boolean;
  frameSrcOverride?: (frameSlug: string) => string;
  agentCursor?: StreamState["agentCursor"];
  phase?: TurnPhase;
  narrations?: string[];
  activeWrites?: StreamState["activeWrites"];
  lastTool?: { name: string; pretty: string } | null;
}) {
```

- [ ] **Step 6: Update Viewport callers in ProjectDetail (host + spectator)**

```bash
grep -rn "<Viewport" studio/src/ | head -10
```

For each caller, pass `activeWrites={state.activeWrites}` (and optionally `lastTool` derived from `state.items` last tool entry).

`lastTool` derivation in caller:

```ts
const lastToolItem = [...state.items].reverse().find((i) => i.kind === "tool");
const lastTool = lastToolItem
  ? { name: lastToolItem.tool, pretty: lastToolItem.pretty }
  : null;
```

- [ ] **Step 7: Delete retired files**

```bash
git rm studio/src/components/viewport/LiveCursorLayer.tsx \
       studio/src/components/viewport/FrameSkeleton.tsx \
       studio/__tests__/components/live-cursor-layer.test.tsx \
       studio/__tests__/components/frame-skeleton.test.tsx
```

- [ ] **Step 8: Run integration test**

```bash
pnpm run studio:test studio/__tests__/components/viewport-partials.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Run full suite**

```bash
pnpm run studio:test
```

Expected: PASS (modulo known-flaky tunnelRendezvous test).

- [ ] **Step 10: Commit**

```bash
git add studio/src/components/viewport/ studio/__tests__/components/
git commit -m "feat(studio/live-cursor): wire PhantomSkeleton/NarrationTicker/EditCursor + retire LiveCursorLayer

Viewport now passes activeWrites by slug into each FrameCard so the
CodeStreamPanel can mount over the iframe during a Write/Edit. Empty
running state renders a phantom card + ticker. EditCursor + ticker
render at viewport level once frames exist. LiveCursorLayer and
FrameSkeleton (plus their tests) are removed."
```

---

## Task 11: Spectator relay round-trip test

**Files:**
- Test: `studio/__tests__/server/relay-partials.test.ts` (new)

The relay copies events verbatim from the host stream into a JSONL replay buffer and re-emits to spectators. A new event kind needs no relay code change, but we want a regression test that confirms it.

- [ ] **Step 1: Locate the relay test pattern**

```bash
ls studio/__tests__/server/relay-* studio/__tests__/relay/ 2>/dev/null
grep -rn "applyStudioEvent\|replay-buffer.jsonl\|persistence" studio/__tests__/server/ 2>/dev/null | head -20
```

Use the existing pattern in any matched file as a template.

- [ ] **Step 2: Write the test**

Create `studio/__tests__/server/relay-partials.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { appendEventToBuffer, readReplayBuffer } from "../../server/relay/persistence";

describe("relay persistence — partial events", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arcade-relay-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips tool_call_started/partial/complete events", async () => {
    const events = [
      { kind: "tool_call_started", toolUseId: "toolu_X", tool: "Write", pretty: "Writing" },
      {
        kind: "tool_input_partial",
        toolUseId: "toolu_X",
        action: "writing" as const,
        filePath: "/projects/p/frames/hero/index.tsx",
        partialContent: "import",
      },
      {
        kind: "tool_input_partial",
        toolUseId: "toolu_X",
        action: "writing" as const,
        filePath: "/projects/p/frames/hero/index.tsx",
        partialContent: "import React",
      },
      { kind: "tool_input_complete", toolUseId: "toolu_X" },
    ];

    for (const e of events) {
      await appendEventToBuffer(dir, e as any);
    }

    const replay = await readReplayBuffer(dir);
    expect(replay).toEqual(events);

    // Raw file is JSONL.
    const raw = readFileSync(join(dir, "replay-buffer.jsonl"), "utf8");
    expect(raw.trim().split("\n").length).toBe(events.length);
  });
});
```

If `appendEventToBuffer` / `readReplayBuffer` exports don't exist, replace with whatever the actual relay persistence module exposes (read the relay `persistence.ts` and adapt).

- [ ] **Step 3: Run test**

```bash
pnpm run studio:test studio/__tests__/server/relay-partials.test.ts
```

Expected: PASS (relay copies events verbatim — no code change needed for new kinds).

- [ ] **Step 4: Commit**

```bash
git add studio/__tests__/server/relay-partials.test.ts
git commit -m "test(studio/live-cursor): relay round-trips partial events verbatim

Asserts that adding new StudioEvent kinds doesn't require a relay
schema change — persistence layer copies opaque JSONL through to
the replay buffer and back."
```

---

## Task 12: Manual end-to-end verification + DMG build

**Files:**
- Modify: `package.json` (version bump)
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Run full suite**

```bash
pnpm run studio:test
```

Expected: PASS (modulo known-flaky tunnelRendezvous).

- [ ] **Step 2: Start dev server and run a real generation**

```bash
pnpm run studio
```

Open localhost:5556. Create a new project. Trigger generation with a Figma URL. Watch:

- Phase 1 (~5–7 min): NarrationTicker visible at viewport bottom; PhantomSkeleton card pulses with bright contrast against viewport bg.
- Phase 2 (Write streaming): CodeStreamPanel mounts inside the frame card, code grows in real time, header shows char count.
- Phase 2 → 3 transition: CodeStreamPanel unmounts when Write completes; iframe loads with the existing wipe animation.
- Phase 3 (subsequent Edits): EditCursor sprite appears, hops between hashed positions per Edit. Stays only while turn is running.
- Turn end: Cursor disappears, ticker fades.

- [ ] **Step 3: Bump version + add changelog entry**

In `package.json`, change `"version"` to `"0.25.0"`.

In `studio/CHANGELOG.md`, prepend a new top entry:

```md
## [0.25.0] — 2026-05-28

### Changed
- **Live cursor v2.** Studio's generation feedback is now driven by the Anthropic SDK's partial-message stream (`--include-partial-messages`), not just completed tool calls. During a turn you now see: a bright phantom skeleton + bottom narration ticker through the read/scan phase, a code panel that types Write content character-by-character into the frame card during scaffolding, and a cursor sprite that hops over the rendered iframe during follow-up edits. The previous LiveCursorLayer + FrameSkeleton are retired.
```

- [ ] **Step 4: Build DMG**

```bash
pnpm run studio:pack
ls -lh "dist/Arcade Studio-0.25.0-arm64.dmg"
```

Expected: DMG produced at `dist/Arcade Studio-0.25.0-arm64.dmg`.

- [ ] **Step 5: Commit version bump**

```bash
git add package.json studio/CHANGELOG.md
git commit -m "chore(studio): bump to 0.25.0 + changelog for live cursor v2"
```

- [ ] **Step 6: Optional notarize + release**

Per `studio/CLAUDE.md` "Releasing a new version" workflow. Skip if user just wants local DMG to test.

---

## Self-Review

**Spec coverage:**
- Goal/architecture → addressed by Tasks 1, 3, 4, 10.
- `tool_call_started` / `tool_input_partial` / `tool_input_complete` events → Task 3 (parser) + Task 4 (reducer).
- `<NarrationTicker>` → Task 7.
- `<CodeStreamPanel>` → Task 8 (component) + Task 10 (wiring).
- `<EditCursor>` → Task 9 (component) + Task 10 (wiring).
- `<PhantomSkeleton>` with `--surface-overlay-strong` token → Tasks 5, 6.
- Spectator pipe parity → Task 11.
- Throttling via rAF: spec mentions but plan defers to natural React batching (per-event setState already lazy in React 19; if we later observe thrash we add rAF coalescing). Acceptable for v1.
- Edge cases (parse failures, abort, replay, iframe race, backpressure): handled inline in parser (Task 3 — `extractStringField` tolerates open strings) and reducer (Task 4 — `end` clears activeWrites; `loadedSlugs` set gates EditCursor).
- Out-of-scope items in spec → not implemented (text_delta narration streaming, diff highlighting, cursor following code typing, parallel multi-Write polish). Correct.

**Placeholder scan:** No "TBD"/"TODO"/"implement later"/vague handwaves. Each step has exact code or exact command.

**Type consistency:**
- `StudioEvent` union variants used in parser (Task 3) match reducer cases (Task 4): `tool_call_started`, `tool_input_partial`, `tool_input_complete`. Match.
- `StreamState.activeWrites` shape used identically in reducer (Task 4) and Viewport (`writesBySlug` derivation, Task 10). Match.
- `EditCursor` props (`agentCursor`, `containerRef`, `frames`, `loadedSlugs`) match Viewport call site (Task 10). Match.
- `FrameCard.activeWrite` is `{ partialContent, filePath }` in both component (Task 10) and `writesBySlug` reducer side (Task 10). Match.

Plan complete.
