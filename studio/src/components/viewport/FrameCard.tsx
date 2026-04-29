import type { Frame } from "../../../server/types";
import { computeFrameSize, type DevicePreset } from "../../lib/devicePresets";

export function FrameCard({
  projectSlug,
  frame,
  devicePreset,
  projectMode,
}: {
  projectSlug: string;
  frame: Frame;
  devicePreset: DevicePreset;
  projectMode: "light" | "dark";
}) {
  const effectiveWidth = computeFrameSize(devicePreset);

  return (
    <div style={{ flex: "none" }}>
      <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle)", marginBottom: 8 }}>{frame.name}</div>
      <div
        style={{
          position: "relative",
          width: effectiveWidth,
          height: "calc(100vh - 180px)",
          background: "var(--surface-shallow)",
          borderRadius: 12,
          overflow: "hidden",
          transition: "width 200ms ease-out",
          willChange: "width",
        }}
      >
        <iframe
          key={projectMode}
          title={frame.name}
          src={`/api/frames/${projectSlug}/${frame.slug}?mode=${projectMode}`}
          style={{ width: "100%", height: "100%", border: 0 }}
        />
      </div>
    </div>
  );
}
