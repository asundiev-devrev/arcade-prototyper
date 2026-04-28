import { useEffect, useRef, useState } from "react";
import { TextShimmer } from "./TextShimmer";

const THOUGHT_ROTATION_INTERVAL_MS = 2500;

/**
 * Matches DevRev's `AgentThoughtsInChat` preview row: a shimmering
 * single-line text that rotates through the agent's current thoughts every
 * 2.5s. No explainable-thoughts accordion for now — Computer's sync API
 * surfaces skill progress as tool_calls, and we collapse them to a rotating
 * preview here.
 */
export function ComputerThinkingRow({ thoughts }: { thoughts: string[] }) {
  const [idx, setIdx] = useState(0);
  const thoughtsRef = useRef(thoughts);

  useEffect(() => { thoughtsRef.current = thoughts; }, [thoughts]);

  useEffect(() => {
    if (thoughts.length <= 1) return;
    const t = setInterval(() => {
      setIdx((prev) => {
        const current = thoughtsRef.current;
        return prev < current.length - 1 ? prev + 1 : prev;
      });
    }, THOUGHT_ROTATION_INTERVAL_MS);
    return () => clearInterval(t);
  }, [thoughts.length]);

  const text = thoughts[idx] ?? thoughts[thoughts.length - 1] ?? "Thinking";

  return (
    <div className="flex items-center gap-1 ml-3 mb-2 text-body">
      <TextShimmer className="truncate" duration={1} spread={25}>
        {text}
      </TextShimmer>
    </div>
  );
}
