import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { EditCursor, _hashCoords } from "../../src/components/viewport/EditCursor";

const FRAMES = [{ slug: "hero" }, { slug: "footer" }];

function Wrapper(props: any) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      data-testid="container"
      style={{ position: "relative", width: 800, height: 600 }}
    >
      <div data-frame-slug="hero" style={{ width: 400, height: 300 }} />
      <EditCursor {...props} containerRef={ref} frames={FRAMES} />
    </div>
  );
}

describe("EditCursor", () => {
  afterEach(() => cleanup());

  it("renders nothing when agentCursor is null", () => {
    const { container } = render(
      <Wrapper agentCursor={null} loadedSlugs={new Set(["hero"])} />,
    );
    expect(container.querySelector('[data-testid="edit-cursor"]')).toBeNull();
  });

  it("renders nothing when action is not editing", () => {
    const { container } = render(
      <Wrapper
        agentCursor={{
          frame: null,
          action: "writing",
          filePath: "/x/frames/hero/index.tsx",
          composites: [],
          updatedAt: 0,
        }}
        loadedSlugs={new Set(["hero"])}
      />,
    );
    expect(container.querySelector('[data-testid="edit-cursor"]')).toBeNull();
  });

  it("renders nothing when slug not in loadedSlugs", () => {
    const { container } = render(
      <Wrapper
        agentCursor={{
          frame: null,
          action: "editing",
          filePath: "/x/frames/hero/index.tsx",
          composites: [],
          updatedAt: 0,
        }}
        loadedSlugs={new Set()}
      />,
    );
    expect(container.querySelector('[data-testid="edit-cursor"]')).toBeNull();
  });

  it("renders when editing AND slug loaded", () => {
    const { container } = render(
      <Wrapper
        agentCursor={{
          frame: null,
          action: "editing",
          filePath: "/x/frames/hero/index.tsx",
          composites: [],
          updatedAt: 0,
        }}
        loadedSlugs={new Set(["hero"])}
      />,
    );
    expect(container.querySelector('[data-testid="edit-cursor"]')).not.toBeNull();
  });

  it("hashes deterministically", () => {
    expect(_hashCoords("foo", 100, 100)).toEqual(_hashCoords("foo", 100, 100));
    expect(_hashCoords("foo", 100, 100)).not.toEqual(_hashCoords("bar", 100, 100));
  });

  it("attaches scroll + resize listeners while visible", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <Wrapper
        agentCursor={{
          frame: null,
          action: "editing",
          filePath: "/x/frames/hero/index.tsx",
          composites: [],
          updatedAt: 0,
        }}
        loadedSlugs={new Set(["hero"])}
      />,
    );
    const addTypes = addSpy.mock.calls.map((c) => c[0]);
    expect(addTypes).toContain("scroll");
    expect(addTypes).toContain("resize");
    unmount();
    const removeTypes = removeSpy.mock.calls.map((c) => c[0]);
    expect(removeTypes).toContain("scroll");
    expect(removeTypes).toContain("resize");
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
