import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { StrictMode, useEffect, useRef } from "react";
import {
  PendingPromptProvider,
  usePendingPrompt,
} from "../../src/hooks/pendingPromptContext";

afterEach(() => {
  cleanup();
});

// Mirrors the pattern in ChatPane.tsx: consume the pending prompt exactly once
// on mount, even under React.StrictMode's double-invoke.
function PromptConsumer({ onFire }: { onFire: (prompt: string) => void }) {
  const pending = usePendingPrompt();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled || firedRef.current) return;
      const p = pending.consume();
      if (!p) return;
      firedRef.current = true;
      onFire(p.prompt);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pending, onFire]);

  return null;
}

describe("PendingPromptContext under StrictMode", () => {
  it("fires the pending prompt exactly once despite StrictMode double-mount", () => {
    vi.useFakeTimers();
    try {
      const onFire = vi.fn();
      // Seed the pending prompt through an outer provider so it's available
      // when the consumer mounts.
      function Harness() {
        const pending = usePendingPrompt();
        // Set on first render — the consumer mounts after.
        if (!(pending as { _seeded?: boolean })._seeded) {
          pending.set({ prompt: "hello", imagePaths: [], figmaUrl: null });
          (pending as { _seeded?: boolean })._seeded = true;
        }
        return <PromptConsumer onFire={onFire} />;
      }
      render(
        <StrictMode>
          <PendingPromptProvider>
            <Harness />
          </PendingPromptProvider>
        </StrictMode>,
      );
      act(() => {
        vi.runAllTimers();
      });
      expect(onFire).toHaveBeenCalledTimes(1);
      expect(onFire).toHaveBeenCalledWith("hello");
    } finally {
      vi.useRealTimers();
    }
  });
});
