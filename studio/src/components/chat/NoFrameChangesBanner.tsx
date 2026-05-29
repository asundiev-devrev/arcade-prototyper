/**
 * Lifts the "no frame changes this turn" warning out of the assistant
 * markdown body and renders it as a dedicated banner. The trailer is still
 * appended server-side (see studio/server/frameChangeContract.ts) so persisted
 * history stays self-describing; the client splits on the sentinel at render
 * time.
 *
 * If the trailer wording in frameChangeContract.ts changes, update the SENTINEL
 * here in lockstep — both files have to agree on the prefix.
 */

const SENTINEL = "⚠ Studio detected no frame changes this turn";

export function splitNoChangesTrailer(content: string): {
  body: string;
  hasWarning: boolean;
} {
  const idx = content.indexOf(SENTINEL);
  if (idx === -1) return { body: content, hasWarning: false };
  return { body: content.slice(0, idx).trimEnd(), hasWarning: true };
}

export function NoFrameChangesBanner() {
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
      <span aria-hidden style={{ flexShrink: 0, fontSize: 14, lineHeight: "1.4" }}>
        ⚠
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>
          No frame changes detected
        </div>
        <div style={{ opacity: 0.9 }}>
          The reply describes edits that didn't actually happen. Try rephrasing,
          pointing at the element again, or asking what went wrong.
        </div>
      </div>
    </div>
  );
}
