import { describe, it, expect } from "vitest";
import { parseStreamLine, type StudioEvent } from "../../src/lib/streamJson";

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
