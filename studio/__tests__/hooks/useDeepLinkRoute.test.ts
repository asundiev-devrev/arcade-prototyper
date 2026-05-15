// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { parseDeepLink } from "../../src/hooks/useDeepLinkRoute";

describe("parseDeepLink", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("returns null when no #join= hash is present", () => {
    expect(parseDeepLink("http://localhost:5556/")).toBeNull();
  });

  it("parses a valid arcade-studio://session deep link", () => {
    const url =
      "http://localhost:5556/#join=" +
      encodeURIComponent(
        "arcade-studio://session/abc-123?relay=https%3A%2F%2Fbar.trycloudflare.com",
      );
    const result = parseDeepLink(url);
    expect(result).toEqual({
      kind: "session",
      sessionId: "abc-123",
      relayUrl: "https://bar.trycloudflare.com",
    });
  });

  it("returns null for a malformed deep link", () => {
    const url =
      "http://localhost:5556/#join=" +
      encodeURIComponent("arcade-studio://wrong-path/abc");
    expect(parseDeepLink(url)).toBeNull();
  });

  it("returns null when the scheme is wrong", () => {
    const url =
      "http://localhost:5556/#join=" +
      encodeURIComponent("https://session/abc?relay=https://bar.trycloudflare.com");
    expect(parseDeepLink(url)).toBeNull();
  });
});

describe("parseDeepLink — project shares (Plan 2b)", () => {
  it("returns a project deep-link from a #share=arcade-studio://project/... fragment", () => {
    const url = encodeURIComponent(
      "arcade-studio://project/abc?relay=https%3A%2F%2Fx.trycloudflare.com&host=devu1&hostName=Andrey&projectSlug=p",
    );
    const result = parseDeepLink(`http://localhost:5556/#share=${url}`);
    expect(result).toEqual({
      kind: "project",
      projectShareId: "abc",
      relayUrl: "https://x.trycloudflare.com",
      hostDevu: "devu1",
      hostDisplayName: "Andrey",
      projectSlug: "p",
    });
  });

  it("returns a session deep-link from the legacy #join=arcade-studio://session/... fragment", () => {
    const url = encodeURIComponent(
      "arcade-studio://session/xyz?relay=https%3A%2F%2Fy.trycloudflare.com",
    );
    const result = parseDeepLink(`http://localhost:5556/#join=${url}`);
    expect(result).toEqual({
      kind: "session",
      sessionId: "xyz",
      relayUrl: "https://y.trycloudflare.com",
    });
  });

  it("returns null for an unrelated fragment", () => {
    expect(parseDeepLink("http://localhost:5556/#notjoin=xyz")).toBeNull();
  });
});
