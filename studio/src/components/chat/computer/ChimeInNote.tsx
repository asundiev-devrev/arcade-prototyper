import { useState } from "react";
import { Computer } from "@xorkavi/arcade-gen";
import type { ChimeIn } from "../../../../server/types";

/**
 * Inline, low-intrusion note rendered under the code-agent turn that
 * triggered it. Collapsed by default: one line summarizing Computer's
 * product-truth objection. Expands to the full text. Apply re-prompts the
 * code agent with the objection; Dismiss hides it.
 */
export function ChimeInNote({
  chime,
  onApply,
  onDismiss,
}: {
  chime: ChimeIn;
  onApply: (c: ChimeIn) => void;
  onDismiss: (c: ChimeIn) => void;
}) {
  const [open, setOpen] = useState(false);
  const firstLine = chime.objection.split("\n")[0];

  return (
    <div
      data-testid="chime-in-note"
      style={{
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 8,
        background: "var(--surface-shallow)",
        padding: "8px 10px",
        fontSize: 13,
        color: "var(--fg-neutral-medium)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          font: "inherit",
        }}
      >
        <span aria-hidden style={{ flexShrink: 0, display: "flex" }}>
          <Computer size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: open ? "normal" : "nowrap" }}>
          {open ? chime.objection : `Computer noticed something — ${firstLine}`}
        </span>
        <span aria-hidden style={{ opacity: 0.5, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
      </button>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onApply(chime)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--stroke-accent-subtle, var(--stroke-neutral-subtle))",
            background: "var(--bg-accent-subtle, transparent)",
            color: "var(--fg-accent-prominent)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => onDismiss(chime)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--stroke-neutral-subtle)",
            background: "transparent",
            color: "var(--fg-neutral-medium)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
