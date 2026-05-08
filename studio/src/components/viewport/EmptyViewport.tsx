import { NewFrameCard } from "./NewFrameCard";

export function EmptyViewport({
  onCreateFrame,
  busy,
}: {
  onCreateFrame: () => void;
  busy?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 24,
        color: "var(--fg-neutral-subtle)",
      }}
    >
      <div>Describe what you want to build — or drop a Figma frame into the chat.</div>
      <div style={{ fontSize: 12 }}>Or</div>
      <NewFrameCard onClick={onCreateFrame} busy={busy} />
    </div>
  );
}
