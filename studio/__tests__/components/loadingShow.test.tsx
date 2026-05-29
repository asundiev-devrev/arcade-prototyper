// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

import {
  LoadingShow,
  _SCENES_FOR_TEST,
} from "../../src/components/viewport/LoadingShow";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LoadingShow", () => {
  it("renders the first scene's caption on mount", () => {
    const { getByRole } = render(<LoadingShow intervalMs={1000} />);
    const status = getByRole("status");
    expect(status.getAttribute("aria-label")).toBe(_SCENES_FOR_TEST[0].caption);
  });

  it("advances to the next scene after intervalMs", () => {
    const { getByRole } = render(<LoadingShow intervalMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    const status = getByRole("status");
    expect(status.getAttribute("aria-label")).toBe(_SCENES_FOR_TEST[1].caption);
  });

  it("loops back to the first scene after the last one", () => {
    const { getByRole } = render(<LoadingShow intervalMs={500} />);
    act(() => {
      vi.advanceTimersByTime(500 * _SCENES_FOR_TEST.length + 50);
    });
    const status = getByRole("status");
    expect(status.getAttribute("aria-label")).toBe(_SCENES_FOR_TEST[0].caption);
  });

  it("renders all scenes simultaneously (only one with data-active)", () => {
    const { container } = render(<LoadingShow intervalMs={1000} />);
    const scenes = container.querySelectorAll(".arcade-studio-loading-scene");
    expect(scenes.length).toBe(_SCENES_FOR_TEST.length);
    const active = container.querySelectorAll(
      ".arcade-studio-loading-scene[data-active]",
    );
    expect(active.length).toBe(1);
  });

  it("respects initialIndex prop", () => {
    const { getByRole } = render(
      <LoadingShow intervalMs={1000} initialIndex={3} />,
    );
    const status = getByRole("status");
    expect(status.getAttribute("aria-label")).toBe(_SCENES_FOR_TEST[3].caption);
  });

  it("clears the interval on unmount", () => {
    const { unmount } = render(<LoadingShow intervalMs={1000} />);
    const before = vi.getTimerCount();
    unmount();
    const after = vi.getTimerCount();
    expect(after).toBeLessThan(before);
  });

  it("exposes a stable scene set with non-empty captions", () => {
    expect(_SCENES_FOR_TEST.length).toBe(6);
    for (const scene of _SCENES_FOR_TEST) {
      expect(scene.id).toBeTruthy();
      expect(scene.caption).toBeTruthy();
      expect(typeof scene.render).toBe("function");
    }
  });
});
