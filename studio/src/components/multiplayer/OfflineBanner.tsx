export function OfflineBanner({ hostName }: { hostName: string }) {
  return (
    <div style={{ background: "#fff3e0", color: "#5a3a1d", padding: 8, fontSize: 13 }}>
      {hostName} is offline — viewing cached state. New comments will be sent when they're back.
    </div>
  );
}
