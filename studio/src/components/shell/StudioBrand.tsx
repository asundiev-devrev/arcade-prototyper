import markUrl from "../../assets/brand/arcade-mark.svg";

/**
 * Arcade wordmark for the home header: the logo mark + "Arcade Studio".
 * Chrome is pinned dark, so the mark and text use onProminent/prominent
 * foreground tokens. Frames are unaffected (separate documents).
 */
export function StudioBrand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <img
        src={markUrl}
        alt=""
        aria-hidden="true"
        style={{ width: 28, height: 28, display: "block" }}
      />
      <span
        style={{
          fontFamily: "var(--core-font-display), 'Chip Display Variable', sans-serif",
          fontWeight: 640,
          fontSize: 18,
          lineHeight: "24px",
          color: "var(--fg-neutral-prominent)",
        }}
      >
        Arcade Studio
      </span>
    </div>
  );
}
