import { describe, it, expect } from "vitest";
import { parseStreamLine, parseStreamLineAll, type StudioEvent } from "../../src/lib/streamJson";

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

  it("signals end on result event", () => {
    const e = parseStreamLine(JSON.stringify({ type: "result", subtype: "success" }));
    expect(e).toEqual<StudioEvent>({ kind: "end", ok: true });
  });

  it("returns error on result failure", () => {
    const e = parseStreamLine(JSON.stringify({ type: "result", subtype: "error_during_execution", error: "boom" }));
    expect(e).toEqual<StudioEvent>({ kind: "end", ok: false, error: "boom" });
  });

  it("surfaces is_error=true even when subtype says success", () => {
    // Regression guard: claude emits `subtype: "success"` together with
    // `is_error: true` and the user-facing message in `result` when auth
    // fails at the Bedrock layer. Without honoring is_error we'd report the
    // turn as a clean success, drop the "AWS SSO expired" message, and the
    // UI would sit on "Thinking…" with no error — cost us a beta tester
    // debug session.
    const e = parseStreamLine(JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "API Error: Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile.",
    }));
    expect(e).toEqual<StudioEvent>({
      kind: "end",
      ok: false,
      error: "API Error: Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile.",
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
