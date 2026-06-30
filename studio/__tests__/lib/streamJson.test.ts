import { describe, it, expect } from "vitest";
import { parseStreamLine, parseStreamLineAll, createStreamParser, type StudioEvent } from "../../src/lib/streamJson";

describe("parseStreamLine", () => {
  it("ignores blank lines", () => {
    expect(parseStreamLine("")).toBeNull();
  });

  it("extracts session id from system init", () => {
    const e = parseStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }));
    expect(e).toEqual<StudioEvent>({ kind: "session", sessionId: "abc" });
  });

  it("extracts narration from assistant text", () => {
    const e = parseStreamLine(JSON.stringify({
      type: "assistant", message: { content: [{ type: "text", text: "Building Welcome screen…" }] },
    }));
    expect(e).toEqual<StudioEvent>({ kind: "narration", text: "Building Welcome screen…" });
  });

  it("maps tool_use Read to plain language", () => {
    const e = parseStreamLine(JSON.stringify({
      type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "frames/01-welcome/index.tsx" } }] },
    }));
    expect(e).toMatchObject({ kind: "tool_call", tool: "Read", pretty: expect.stringContaining("Reading") });
  });

  it("maps figmanage bash calls to a Figma narration", () => {
    const e = parseStreamLine(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "figmanage reading get-nodes --depth 5 --json abc123 1:2" } }] },
    }));
    expect(e).toMatchObject({ kind: "tool_call", tool: "Figma", pretty: expect.stringContaining("Figma") });
  });

  it("signals end on result event (after a turn_metrics event)", () => {
    // The result line now emits `turn_metrics` THEN `end`. The end signal is
    // the last event; assert it's present.
    const evs = parseStreamLineAll(JSON.stringify({ type: "result", subtype: "success" }));
    expect(evs[evs.length - 1]).toEqual<StudioEvent>({ kind: "end", ok: true });
    expect(evs.some((e) => e.kind === "turn_metrics")).toBe(true);
  });

  it("returns error on result failure", () => {
    const evs = parseStreamLineAll(JSON.stringify({ type: "result", subtype: "error_during_execution", error: "boom" }));
    expect(evs[evs.length - 1]).toEqual<StudioEvent>({ kind: "end", ok: false, error: "boom" });
  });

  it("surfaces is_error=true even when subtype says success", () => {
    // Regression guard: claude emits `subtype: "success"` together with
    // `is_error: true` and the user-facing message in `result` when auth
    // fails at the Bedrock layer. Without honoring is_error we'd report the
    // turn as a clean success, drop the "AWS SSO expired" message, and the
    // UI would sit on "Thinking…" with no error — cost us a beta tester
    // debug session.
    const evs = parseStreamLineAll(JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "API Error: Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile.",
    }));
    expect(evs[evs.length - 1]).toEqual<StudioEvent>({
      kind: "end",
      ok: false,
      error: "API Error: Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile.",
    });
  });

  it("extracts per-turn telemetry from the result line", () => {
    const evs = parseStreamLineAll(JSON.stringify({
      type: "result",
      subtype: "success",
      duration_ms: 9708,
      ttft_ms: 9136,
      num_turns: 3,
      total_cost_usd: 0.1284,
      usage: {
        input_tokens: 2,
        output_tokens: 6,
        cache_creation_input_tokens: 34230,
        cache_read_input_tokens: 12000,
      },
      modelUsage: { "us.anthropic.claude-sonnet-4-6": { inputTokens: 2 } },
    }));
    const m = evs.find((e) => e.kind === "turn_metrics");
    expect(m).toMatchObject({
      kind: "turn_metrics",
      durationMs: 9708,
      ttftMs: 9136,
      numTurns: 3,
      model: "us.anthropic.claude-sonnet-4-6",
      cacheCreationTokens: 34230,
      cacheReadTokens: 12000,
      outputTokens: 6,
      costUsd: 0.1284,
    });
  });

  it("returns null for unrelated garbage", () => {
    expect(parseStreamLine("not json")).toBeNull();
  });
});

describe("parseStreamLineAll: agent_cursor", () => {
  it("emits agent_cursor reading after a Read tool_call", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/p/frames/home/index.tsx" },
          },
        ],
      },
    }));
    expect(events).toEqual([
      expect.objectContaining({ kind: "tool_call", tool: "Read" }),
      {
        kind: "agent_cursor",
        frame: null,
        action: "reading",
        filePath: "/p/frames/home/index.tsx",
      },
    ]);
  });

  it("emits agent_cursor writing with composites for Write", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: {
              file_path: "/p/frames/home/index.tsx",
              content: 'import { Button } from "@xorkavi/arcade-gen";',
            },
          },
        ],
      },
    }));
    const cursor = events.find((e) => e.kind === "agent_cursor");
    expect(cursor).toEqual({
      kind: "agent_cursor",
      frame: null,
      action: "writing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Button"],
    });
  });

  it("emits agent_cursor editing with composites for Edit", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: {
              file_path: "/p/frames/home/index.tsx",
              new_string: 'import { Card } from "@xorkavi/arcade-gen";',
            },
          },
        ],
      },
    }));
    const cursor = events.find((e) => e.kind === "agent_cursor");
    expect(cursor).toEqual({
      kind: "agent_cursor",
      frame: null,
      action: "editing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Card"],
    });
  });

  it("emits agent_cursor thinking with frame=null for Bash", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    }));
    const cursor = events.find((e) => e.kind === "agent_cursor");
    expect(cursor).toEqual({ kind: "agent_cursor", frame: null, action: "thinking" });
  });

  it("does not emit agent_cursor for plain narration", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Building Home" }] },
    }));
    expect(events.find((e) => e.kind === "agent_cursor")).toBeUndefined();
    expect(events.find((e) => e.kind === "narration")).toBeDefined();
  });
});

describe("createStreamParser: per-turn isolation", () => {
  const blockStart = (index: number, id: string, name: string) =>
    JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_start", index, content_block: { type: "tool_use", id, name } },
    });
  const blockDelta = (index: number, partial: string) =>
    JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: partial } },
    });

  it("does not cross-talk partial tool input between two parsers on the same block index", () => {
    const a = createStreamParser();
    const b = createStreamParser();

    // Both turns open a Write tool at block index 0 — the shared-global bug
    // had them clobbering each other's buffer.
    a.parseLine(blockStart(0, "tool-a", "Write"));
    b.parseLine(blockStart(0, "tool-b", "Write"));

    a.parseLine(blockDelta(0, '{"file_path":"/p/frames/a/index.tsx","content":"AAA'));
    const bEvents = b.parseLine(blockDelta(0, '{"file_path":"/p/frames/b/index.tsx","content":"BBB'));

    const bPartial = bEvents.find((e) => e.kind === "tool_input_partial");
    expect(bPartial).toMatchObject({
      kind: "tool_input_partial",
      toolUseId: "tool-b",
      filePath: "/p/frames/b/index.tsx",
      partialContent: "BBB",
    });

    // Parser A's next delta must still reflect ONLY A's accumulated buffer.
    const aEvents = a.parseLine(blockDelta(0, 'AAA"}'));
    const aPartial = aEvents.find((e) => e.kind === "tool_input_partial");
    expect(aPartial).toMatchObject({
      kind: "tool_input_partial",
      toolUseId: "tool-a",
      filePath: "/p/frames/a/index.tsx",
      partialContent: "AAAAAA",
    });
  });

  it("one parser's result event does not clear another parser's in-flight buffer", () => {
    const a = createStreamParser();
    const b = createStreamParser();
    a.parseLine(blockStart(0, "tool-a", "Write"));
    a.parseLine(blockDelta(0, '{"file_path":"/p/frames/a/index.tsx","content":"hello'));

    // Turn B terminates — its result event must not wipe A's buffer.
    b.parseLine(JSON.stringify({ type: "result", subtype: "success" }));

    const aEvents = a.parseLine(blockDelta(0, ' world'));
    const aPartial = aEvents.find((e) => e.kind === "tool_input_partial");
    expect(aPartial).toMatchObject({ partialContent: "hello world" });
  });

  it("extracts filePath + partialContent when the CLI emits standard JSON spacing", () => {
    // Bedrock streams real JSON with a space after the colon (`"content": "`).
    // The old exact `"content":"` opener missed it and left every live code
    // preview blank — verify the space-tolerant extraction handles both.
    const p = createStreamParser();
    p.parseLine(blockStart(0, "tool-w", "Write"));
    const events = p.parseLine(
      blockDelta(0, '{"file_path": "/p/frames/pricing/index.tsx", "content": "export function Pricing'),
    );
    const partial = events.find((e) => e.kind === "tool_input_partial");
    expect(partial).toMatchObject({
      kind: "tool_input_partial",
      action: "writing",
      filePath: "/p/frames/pricing/index.tsx",
      partialContent: "export function Pricing",
    });
  });

  it("extracts new_string for an Edit with standard JSON spacing", () => {
    const p = createStreamParser();
    p.parseLine(blockStart(0, "tool-e", "Edit"));
    const events = p.parseLine(
      blockDelta(0, '{"file_path": "/p/frames/home/index.tsx", "old_string": "Hi", "new_string": "Hello there'),
    );
    const partial = events.find((e) => e.kind === "tool_input_partial");
    expect(partial).toMatchObject({
      action: "editing",
      filePath: "/p/frames/home/index.tsx",
      partialContent: "Hello there",
    });
  });
});
