import { describe, it, expect } from "vitest";
import { classifyFrameError } from "../../server/middleware/runtimeError";

describe("classifyFrameError", () => {
  it("module not found from export error", () => {
    expect(classifyFrameError("does not provide an export named 'Lightning'")).toBe("module_not_found");
  });
  it("syntax error", () => {
    expect(classifyFrameError("SyntaxError: Unexpected token")).toBe("syntax_error");
  });
  it("hmr failure", () => {
    expect(classifyFrameError("[hmr] Failed to reload")).toBe("hmr_failure");
  });
  it("runtime exception fallback", () => {
    expect(classifyFrameError("Cannot read properties of undefined")).toBe("runtime_exception");
  });
});
