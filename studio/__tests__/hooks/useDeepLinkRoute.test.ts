// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { parseDeepLink } from "../../src/hooks/useDeepLinkRoute";

describe("parseDeepLink", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("returns null when no #join= hash is present", () => {
    window.location.hash = "";
    expect(parseDeepLink()).toBeNull();
  });

  it("parses a valid arcade-studio://session deep link", () => {
    window.location.hash = "#join=" + encodeURIComponent(
      "arcade-studio://session/abc-123?relay=https%3A%2F%2Fbar.trycloudflare.com",
    );
    const result = parseDeepLink();
    expect(result).toEqual({
      sessionId: "abc-123",
      relayUrl: "https://bar.trycloudflare.com",
    });
  });

  it("returns null for a malformed deep link", () => {
    window.location.hash = "#join=" + encodeURIComponent(
      "arcade-studio://wrong-path/abc",
    );
    expect(parseDeepLink()).toBeNull();
  });

  it("returns null when the scheme is wrong", () => {
    window.location.hash = "#join=" + encodeURIComponent(
      "https://session/abc?relay=https://bar.trycloudflare.com",
    );
    expect(parseDeepLink()).toBeNull();
  });
});
