/**
 * Soft, non-accusatory banner for "the render doesn't match what you asked" —
 * shown when the user's requested visual property (e.g. vertical) still
 * contradicts the render after one corrective retry. Distinct sentinel from
 * VisualNoOpBanner / NoFrameChangesBanner so none collide. See the spec.
 */

export const RENDER_MISMATCH_SENTINEL = "⚠ Studio: the result doesn't match what you asked for";

export function splitRenderMismatchTrailer(content: string): { body: string; hasWarning: boolean } {
  const idx = content.indexOf(RENDER_MISMATCH_SENTINEL);
  if (idx === -1) return { body: content, hasWarning: false };
  return { body: content.slice(0, idx).trimEnd(), hasWarning: true };
}

export function RenderMismatchBanner() {
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
        borderRadius: 8, background: "var(--bg-warning-subtle, #fff3e0)",
        color: "var(--fg-warning-prominent, #8b4500)",
        border: "1px solid var(--stroke-warning-subtle, rgba(139, 69, 0, 0.15))",
        fontSize: 13, lineHeight: 1.5,
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, fontSize: 14, lineHeight: "1.4" }}>⚠</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>Doesn't match your request</div>
        <div style={{ opacity: 0.9 }}>
          You asked for a change the render doesn't show — the component may not support it.
          Try describing the layout you want a different way.
        </div>
      </div>
    </div>
  );
}
