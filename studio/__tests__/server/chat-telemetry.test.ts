import { describe, it, expect } from "vitest";
import { classifyGenerationError, buildWirePrompt } from "../../server/middleware/chat";

describe("classifyGenerationError", () => {
  it("bedrock auth from message", () => {
    expect(classifyGenerationError({ error: "Bedrock credentials expired", timedOut: false, exitCode: 0 })).toBe("bedrock_auth");
  });
  it("timeout", () => {
    expect(classifyGenerationError({ error: "timed out after 120s", timedOut: true, exitCode: null })).toBe("timeout");
  });
  it("cli crash on nonzero exit", () => {
    expect(classifyGenerationError({ error: "boom", timedOut: false, exitCode: 1 })).toBe("cli_crash");
  });
  it("parser error from message", () => {
    expect(classifyGenerationError({ error: "Failed to parse response", timedOut: false, exitCode: 0 })).toBe("parser_error");
  });
  it("other fallback", () => {
    expect(classifyGenerationError({ error: "weird", timedOut: false, exitCode: 0 })).toBe("other");
  });
});

describe("buildWirePrompt", () => {
  const userPrompt = 'Implement this screen. CRITICAL: clicking "Connect Outlook" opens this modal.';
  const out = buildWirePrompt("01-screen", userPrompt);

  it("targets only the screen index.tsx and references the imported Overlay", () => {
    expect(out).toContain("frames/01-screen/index.tsx");
    expect(out).toContain("./Overlay");
    expect(out).toContain("Overlay.tsx");
  });
  it("instructs a DEFAULT import (the emitter emits `export default`)", () => {
    expect(out).toContain('import Overlay from "./Overlay"');
    // Must NOT tell the model to use named-import braces, which would crash.
    expect(out).not.toContain('import { Overlay }');
  });
  it("forbids a new frame and forbids redesigning either file", () => {
    expect(out).toContain("Do NOT create a new frame");
    expect(out.toLowerCase()).toContain("do not redesign");
  });
  it("requires state, a click handler, and a dimmed backdrop", () => {
    expect(out).toContain("useState");
    expect(out).toContain("onClick");
    expect(out).toContain("backdrop");
  });
  it("includes the designer's original request verbatim (for the trigger)", () => {
    expect(out).toContain(userPrompt);
  });
  it("carries NO figma url (stays in edit mode, never re-imports)", () => {
    expect(out).not.toContain("figma.com");
    expect(out).not.toContain("http");
  });
});
