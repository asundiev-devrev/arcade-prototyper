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
});
