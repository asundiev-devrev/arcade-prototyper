import type { EditBlock } from "../../hooks/editBlocksContext";

export function EditBlockRow({ block, onUndo, onApply, onDiscard }: {
  block: EditBlock;
  onUndo: (id: string) => void;
  onApply: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const muted = block.status === "undone";
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      padding: "6px 10px", borderRadius: 8, fontSize: 12,
      background: "var(--bg-neutral-soft)", opacity: muted ? 0.5 : 1,
      border: "1px solid var(--stroke-neutral-subtle)",
    }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {block.status === "applied" && <span aria-hidden style={{ marginRight: 4 }}>✓</span>}
        {block.status === "working" && <span aria-hidden style={{ marginRight: 4 }}>⏳</span>}
        <span>{block.label}</span>
      </span>
      <span style={{ display: "flex", gap: 6, flex: "none" }}>
        {block.kind === "instant" && block.status === "applied" && (
          <button type="button" onClick={() => onUndo(block.id)} style={btn}>Undo</button>
        )}
        {block.kind === "ai" && block.status === "pending" && (
          <>
            <button type="button" onClick={() => onApply(block.id)} style={btn}>Apply</button>
            <button type="button" onClick={() => onDiscard(block.id)} style={btn}>Discard</button>
          </>
        )}
      </span>
    </div>
  );
}
const btn: React.CSSProperties = {
  background: "transparent", border: "none", color: "var(--fg-accent)",
  cursor: "pointer", fontSize: 12, padding: 0,
};
