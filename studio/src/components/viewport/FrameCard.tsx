import type { Frame } from "../../../server/types";
import { computeFrameSize, type DevicePreset } from "../../lib/devicePresets";
import { useChatStreamContext } from "../../hooks/chatStreamContext";

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
  const { state, refine } = useChatStreamContext();

  return (
    <div style={{ flex: "none" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          fontSize: 12,
          color: "var(--fg-neutral-subtle)",
        }}
      >
        <span>{frame.name}</span>
        <button
          type="button"
          title="Refine this frame against the most recent reference image in chat"
          disabled={state.busy}
          onClick={() => void refine(frame.slug)}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 6,
            border: "1px solid var(--stroke-neutral-subtle)",
            background: "var(--surface-overlay)",
            color: state.busy ? "var(--fg-neutral-tertiary)" : "var(--fg-neutral-primary)",
            cursor: state.busy ? "not-allowed" : "pointer",
          }}
        >
          Refine against reference
        </button>
      </div>
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
