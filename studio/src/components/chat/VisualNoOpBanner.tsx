/**
 * Soft, non-accusatory banner for "the code changed but nothing on screen
 * moved" — shown when a visual-no-op survived one corrective retry. Distinct
 * sentinel from NoFrameChangesBanner so the two never collide in the
 * persisted-message split. See the spec.
 */

export const VISUAL_NOOP_SENTINEL = "⚠ Studio: this change didn't move anything on screen";

export function splitVisualNoOpTrailer(content: string): { body: string; hasWarning: boolean } {
  const idx = content.indexOf(VISUAL_NOOP_SENTINEL);
  if (idx === -1) return { body: content, hasWarning: false };
  return { body: content.slice(0, idx).trimEnd(), hasWarning: true };
}

export function VisualNoOpBanner() {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        background: "var(--bg-warning-subtle, #fff3e0)",
        color: "var(--fg-warning-prominent, #8b4500)",
        border: "1px solid var(--stroke-warning-subtle, rgba(139, 69, 0, 0.15))",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, fontSize: 14, lineHeight: "1.4" }}>⚠</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>Nothing changed on screen</div>
        <div style={{ opacity: 0.9 }}>
          This change updated the code but nothing on screen moved — the setting may be one this
          component ignores. If you expected a visual change, try describing the look you want.
        </div>
      </div>
    </div>
  );
}
