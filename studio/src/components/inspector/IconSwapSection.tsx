import { useState } from "react";
import { IconGridPopover } from "./IconGridPopover";

export function IconSwapSection({ currentName, currentSvg, icons, onPickIcon }: {
  currentName: string;
  currentSvg: string | undefined;
  icons: { name: string; svg: string; tags: string[] }[];
  onPickIcon: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
      <span aria-hidden="true" style={{ width: 24, height: 24, flex: "none", display: "flex",
        alignItems: "center", justifyContent: "center", color: "var(--fg-neutral-prominent)" }}
        dangerouslySetInnerHTML={currentSvg ? { __html: currentSvg } : undefined} />
      <span style={{ flex: 1, fontSize: 12, color: "var(--fg-neutral-prominent)", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentName}</span>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ height: 28, padding: "0 10px", borderRadius: 6, border: "1px solid var(--stroke-neutral-subtle)",
          background: "var(--bg-neutral-soft)", color: "var(--fg-neutral-prominent)", fontSize: 12, cursor: "pointer" }}>
        Replace
      </button>
      {open && <IconGridPopover icons={icons} onPick={onPickIcon} onClose={() => setOpen(false)} />}
    </div>
  );
}
