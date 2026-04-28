import type { ReactNode } from "react";

/**
 * Visual reimplementation of DevRev's `TextShimmer` (they use
 * `design-system/shared/raw-design-system/.../text-shimmer`). A faint
 * highlight sweeps across the text horizontally. Matches `duration=1s`,
 * `spread≈25px` that Computer uses for its rotating "thinking" thought row.
 */
export function TextShimmer({
  children,
  duration = 1,
  spread = 25,
  className = "",
}: {
  children: ReactNode;
  duration?: number;
  spread?: number;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={
        {
          backgroundImage:
            "linear-gradient(90deg, var(--shimmer-base) 0%, var(--shimmer-highlight) 50%, var(--shimmer-base) 100%)",
          backgroundSize: `${spread * 8}px 100%`,
          backgroundPosition: "-100% 0",
          backgroundRepeat: "no-repeat",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          animation: `computer-text-shimmer ${duration}s linear infinite`,
          "--shimmer-base": "var(--fg-neutral-subtle)",
          "--shimmer-highlight": "var(--fg-neutral-prominent)",
        } as React.CSSProperties
      }
    >
      <style>{`
        @keyframes computer-text-shimmer {
          0% { background-position: -100% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
      {children}
    </span>
  );
}
