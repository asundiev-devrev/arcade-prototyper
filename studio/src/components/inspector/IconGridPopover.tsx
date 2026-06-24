import { useState } from "react";

export function IconGridPopover({ icons, onPick, onClose }: {
  icons: { name: string; svg: string; tags: string[] }[];
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = q.trim()
    ? icons.filter((i) => {
        const s = q.toLowerCase();
        return i.name.toLowerCase().includes(s) || i.tags.some((t) => t.toLowerCase().includes(s));
      })
    : icons;
  return (
    <div role="dialog" aria-label="Choose icon" style={{
      position: "absolute", right: 0, top: "100%", zIndex: 10, marginTop: 4, width: 280, maxHeight: 320,
      overflow: "auto", background: "var(--surface-overlay)", border: "1px solid var(--stroke-neutral-subtle)",
      borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.16)", padding: 8,
    }}>
      <input aria-label="Search icons" placeholder="Search icons" value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", height: 28, padding: "0 8px", marginBottom: 8,
          borderRadius: 6, border: "1px solid var(--stroke-neutral-subtle)", background: "var(--bg-neutral-soft)",
          color: "var(--fg-neutral-prominent)", fontSize: 12 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4 }}>
        {filtered.map((i) => (
          <button key={i.name} type="button" aria-label={i.name} title={i.name}
            onClick={() => { onPick(i.name); onClose(); }}
            style={{ aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid transparent", borderRadius: 6, background: "transparent", cursor: "pointer",
              color: "var(--fg-neutral-prominent)" }}
            // catalog svg is trusted (ships with arcade-gen); render inline
            dangerouslySetInnerHTML={{ __html: i.svg }} />
        ))}
      </div>
    </div>
  );
}
