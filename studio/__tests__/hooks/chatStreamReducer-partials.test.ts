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
      action: "writing",
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
