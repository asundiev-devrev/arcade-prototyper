import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  PendingPromptProvider,
  usePendingPrompt,
} from "../../src/hooks/pendingPromptContext";

const wrapper = ({ children }: { children: ReactNode }) => (
  <PendingPromptProvider>{children}</PendingPromptProvider>
);

describe("PendingPromptContext", () => {
  it("stores a prompt and consume() returns + clears it", () => {
    const { result } = renderHook(() => usePendingPrompt(), { wrapper });

    act(() => {
      result.current.set({ prompt: "hi", imagePaths: ["/a"], figmaUrl: null });
    });

    const consumed = result.current.consume();
    expect(consumed).toEqual({ prompt: "hi", imagePaths: ["/a"], figmaUrl: null });

    // Second consume returns null — one-shot semantics.
    expect(result.current.consume()).toBeNull();
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => usePendingPrompt())).toThrow();
  });
});
