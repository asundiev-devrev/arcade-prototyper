import { describe, it, expect } from "vitest";
import { classifyGenerationError } from "../../server/middleware/chat";

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
