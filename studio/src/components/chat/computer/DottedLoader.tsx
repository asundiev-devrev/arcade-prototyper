/**
 * Port of DevRev's `DottedLoader` from
 * `libs/marketing/shared/ui-components/src/atoms/dotted-loader` — three dots
 * fading in sequence. The animation timing (1.5s cycle, 0.3s stagger) matches
 * the upstream SCSS exactly.
 */
export function DottedLoader({ size = "base" }: { size?: "base" | "sm" }) {
  const dotSize = size === "sm" ? 2 : 3;
  return (
    <div className="flex items-center justify-center gap-0.5">
      <style>{`
        @keyframes computer-dot-cycle {
          0%, 100% { opacity: 0; }
          30% { opacity: 1; }
          70% { opacity: 1; }
        }
      `}</style>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            backgroundColor: "currentColor",
            opacity: 0,
            animation: `computer-dot-cycle 1.5s ease-in-out ${i * 0.3}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
