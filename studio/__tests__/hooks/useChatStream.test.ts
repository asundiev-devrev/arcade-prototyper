import { describe, it, expect } from "vitest";
import { classifyError } from "../../src/hooks/useChatStream";

describe("classifyError", () => {
  it("classifies SSO session messages as auth", () => {
    expect(classifyError("sso session expired")).toBe("auth");
  });

  it("classifies credential errors as auth", () => {
    expect(classifyError("AWS credential chain failed")).toBe("auth");
  });

  it("classifies expired tokens as auth", () => {
    expect(classifyError("token is expired")).toBe("auth");
  });

  it("classifies unauthorized responses as auth", () => {
    expect(classifyError("401 Unauthorized")).toBe("auth");
  });

  it("classifies everything else as generic", () => {
    expect(classifyError("generic failure")).toBe("generic");
    expect(classifyError("network timeout")).toBe("generic");
    expect(classifyError("")).toBe("generic");
  });
});
