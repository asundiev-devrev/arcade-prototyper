// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { handleDigestMessage } from "../../src/frame/frameDigest";

describe("handleDigestMessage", () => {
  const digest = { elements: [], truncated: false };
  it("forwards a live-nonce digest for this frame", () => {
    const cb = vi.fn();
    handleDigestMessage(
      { type: "arcade-studio:frame-digest", slug: "p", frame: "f", n: "0", digest },
      { projectSlug: "p", frameSlug: "f", committedNonce: 0, reloadNonce: 0, onRenderDigest: cb },
    );
    expect(cb).toHaveBeenCalledWith("f", digest);
  });
  it("ignores a different frame", () => {
    const cb = vi.fn();
    handleDigestMessage(
      { type: "arcade-studio:frame-digest", slug: "p", frame: "other", n: "0", digest },
      { projectSlug: "p", frameSlug: "f", committedNonce: 0, reloadNonce: 0, onRenderDigest: cb },
    );
    expect(cb).not.toHaveBeenCalled();
  });
  it("ignores a stale (non-live) nonce", () => {
    const cb = vi.fn();
    handleDigestMessage(
      { type: "arcade-studio:frame-digest", slug: "p", frame: "f", n: "9", digest },
      { projectSlug: "p", frameSlug: "f", committedNonce: 0, reloadNonce: 1, onRenderDigest: cb },
    );
    expect(cb).not.toHaveBeenCalled();
  });
  it("accepts the initial n='' render (0↔'' normalization)", () => {
    const cb = vi.fn();
    handleDigestMessage(
      { type: "arcade-studio:frame-digest", slug: "p", frame: "f", n: "", digest },
      { projectSlug: "p", frameSlug: "f", committedNonce: 0, reloadNonce: 0, onRenderDigest: cb },
    );
    expect(cb).toHaveBeenCalledWith("f", digest);
  });
});
