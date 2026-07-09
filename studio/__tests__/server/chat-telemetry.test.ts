import { describe, it, expect } from "vitest";
import { classifyGenerationError, buildWirePrompt } from "../../server/middleware/chat";

describe("classifyGenerationError", () => {
  it("bedrock auth from message", () => {
    expect(classifyGenerationError({ error: "Bedrock credentials expired", timedOut: false, exitCode: 0 })).toBe("bedrock_auth");
  });
  it("timeout when it stalled AFTER streaming started (sawOutput true / default)", () => {
    expect(classifyGenerationError({ error: "timed out after 120s", timedOut: true, exitCode: null })).toBe("timeout");
    expect(classifyGenerationError({ error: "stall", timedOut: true, exitCode: null, sawOutput: true })).toBe("timeout");
  });
  it("stalled_no_output when a stall produced ZERO tokens (Bedrock never answered)", () => {
    expect(classifyGenerationError({ error: "stall", timedOut: true, exitCode: null, sawOutput: false })).toBe("stalled_no_output");
  });
  it("an auth/credential message wins over the timedOut flag (was buried under 'timeout')", () => {
    // The self-heal rewrites a zero-output stall to an SSO message; even with
    // timedOut still set, the message must classify as bedrock_auth so PostHog
    // shows the real cause instead of a generic timeout.
    expect(classifyGenerationError({
      error: "Your AWS session appears to have expired mid-session — run `aws sso login`…",
      timedOut: true, exitCode: null, sawOutput: false,
    })).toBe("bedrock_auth");
  });
  it("auth message wins even when output DID stream (sawOutput true)", () => {
    expect(classifyGenerationError({
      error: "Bedrock credentials expired", timedOut: true, exitCode: null, sawOutput: true,
    })).toBe("bedrock_auth");
  });
  it("a timeout message mentioning token COUNTS is not misread as auth", () => {
    // Guard for the tightened regex: a bare "tokens" (output-count context)
    // must NOT match the auth branch.
    expect(classifyGenerationError({
      error: "timed out after streaming 4000 tokens", timedOut: true, exitCode: null, sawOutput: true,
    })).toBe("timeout");
  });
  it("an expired BEARER TOKEN message still classifies as auth", () => {
    expect(classifyGenerationError({
      error: "bearer token expired", timedOut: true, exitCode: null, sawOutput: false,
    })).toBe("bedrock_auth");
  });
  it("cli crash on nonzero exit", () => {
    expect(classifyGenerationError({ error: "boom", timedOut: false, exitCode: 1 })).toBe("cli_crash");
  });
  it("parser error from message", () => {
    expect(classifyGenerationError({ error: "Failed to parse response", timedOut: false, exitCode: 0 })).toBe("parser_error");
  });
  it("throttled — and wins over bedrock_auth even though the message says 'Bedrock'", () => {
    expect(classifyGenerationError({
      error: "Bedrock is rate-limiting your account right now (too many requests). Wait ~30 seconds…",
      timedOut: false, exitCode: 0,
    })).toBe("throttled");
    expect(classifyGenerationError({ error: "ThrottlingException", timedOut: false, exitCode: 0 })).toBe("throttled");
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
