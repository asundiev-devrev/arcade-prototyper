// @vitest-environment node
import { describe, it, expect } from "vitest";
import { classifyShareError } from "../../server/middleware/cloudflare";

describe("classifyShareError", () => {
  it("auth from invalid_key code", () => {
    expect(classifyShareError({ code: "invalid_key", status: 401 })).toBe("auth");
  });
  it("worker 5xx", () => {
    expect(classifyShareError({ code: undefined, status: 503 })).toBe("worker_5xx");
  });
  it("bundle error", () => {
    expect(classifyShareError({ code: "bundle_error", status: 500 })).toBe("bundle_error");
  });
  it("network fallback", () => {
    expect(classifyShareError({ code: undefined, status: 0 })).toBe("network");
  });
});
