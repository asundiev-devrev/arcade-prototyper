interface Connection {
  devu: string;
  displayName: string;
}

/**
 * Tiny avatar strip rendered in the project header showing who is currently
 * connected to the multiplayer session — host first (purple), then guests
 * (lighter purple). Renders nothing when no one is connected.
 *
 * The data wiring (host-side EventSource pulling presence from the relay)
 * lands in Task 21; for now this component just renders whatever the parent
 * passes in.
 */
export function PresenceStrip({
  host,
  guests,
}: {
  host: Connection | null;
  guests: Connection[];
}) {
  if (!host && guests.length === 0) return null;

  const dot = (bg: string): React.CSSProperties => ({
    width: 24,
    height: 24,
    borderRadius: 12,
    background: bg,
    color: "white",
    display: "grid",
    placeItems: "center",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    border: "1.5px solid var(--surface-overlay)",
  });

  return (
    <div style={{ display: "flex", gap: -4, alignItems: "center" }}>
      {host ? (
        <div title={`Host: ${host.displayName}`} style={dot("#7c3aed")}>
          {host.displayName.slice(0, 1)}
        </div>
      ) : null}
      {guests.map((g, i) => (
        <div
          key={g.devu}
          title={g.displayName}
          style={{ ...dot("#a78bfa"), marginLeft: i === 0 && !host ? 0 : -6 }}
        >
          {g.displayName.slice(0, 1)}
        </div>
      ))}
    </div>
  );
}
