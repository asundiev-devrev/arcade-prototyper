const PROMPTS = [
  "Build a login screen",
  "Create a dashboard with a bar chart and a data table",
  "Design a settings page with tabs",
];

export function EmptyStatePrompts({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div style={{ display: "grid", gap: 8, padding: 12 }}>
      <div style={{ color: "var(--fg-neutral-subtle)", fontSize: 12 }}>Try starting with:</div>
      {PROMPTS.map((p) => (
        <button
          key={p}
          onClick={() => onPick(p)}
          style={{
            textAlign: "left", padding: "8px 12px", borderRadius: 8,
            background: "var(--bg-neutral-subtle)", border: "1px solid var(--control-stroke-neutral-medium-active)",
            color: "var(--fg-neutral-prominent)", cursor: "pointer",
          }}
        >{p}</button>
      ))}
    </div>
  );
}
