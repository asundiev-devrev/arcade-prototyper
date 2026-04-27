import { useEffect, useRef, useState } from "react";
import { Computer } from "@xorkavi/arcade-gen";

export interface MentionOption {
  id: string;
  /** Token inserted into the textarea when selected (without leading @). */
  token: string;
  label: string;
  description?: string;
  icon?: "computer";
}

export const MENTION_OPTIONS: MentionOption[] = [
  {
    id: "computer",
    token: "Computer",
    label: "Computer",
    description: "DevRev agent",
    icon: "computer",
  },
];

interface MentionPopoverProps {
  query: string;
  anchor: { left: number; bottom: number } | null;
  onSelect: (option: MentionOption) => void;
  onDismiss: () => void;
}

export function filterMentions(query: string): MentionOption[] {
  const q = query.toLowerCase();
  return MENTION_OPTIONS.filter((o) =>
    o.token.toLowerCase().startsWith(q) || o.label.toLowerCase().startsWith(q),
  );
}

export function MentionPopover({ query, anchor, onSelect, onDismiss }: MentionPopoverProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const options = filterMentions(query);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!options.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + options.length) % options.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onSelect(options[activeIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    }
    // Capture phase so we win over ChatInput's textarea handler (which also
    // binds Enter).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [options, activeIdx, onSelect, onDismiss]);

  if (!anchor || !options.length) return null;

  return (
    <div
      ref={rootRef}
      role="listbox"
      style={{
        position: "fixed",
        left: anchor.left,
        bottom: anchor.bottom,
        minWidth: 220,
        background: "var(--surface-overlay)",
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        padding: 4,
        zIndex: 1000,
      }}
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="option"
          aria-selected={i === activeIdx}
          onMouseDown={(e) => { e.preventDefault(); onSelect(o); }}
          onMouseEnter={() => setActiveIdx(i)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 8px",
            border: "none",
            background: i === activeIdx ? "var(--bg-neutral-soft)" : "transparent",
            borderRadius: 6,
            cursor: "pointer",
            textAlign: "left",
            color: "var(--fg-neutral-prominent)",
          }}
        >
          <span style={{ display: "flex", width: 16, height: 16 }}>
            {o.icon === "computer" ? <Computer size={16} /> : null}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{o.label}</span>
          {o.description ? (
            <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)", marginLeft: "auto" }}>
              {o.description}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
