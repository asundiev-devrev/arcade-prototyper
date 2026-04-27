import { useState } from "react";
import type { Frame } from "../../../server/types";
import { FrameCornerMenu } from "./FrameCornerMenu";
import { computeFrameSize, type DevicePreset } from "../../lib/devicePresets";

export function FrameCard({
  projectSlug,
  frame,
  devicePreset,
  projectMode,
  onFramesChanged,
}: {
  projectSlug: string;
  frame: Frame;
  devicePreset: DevicePreset;
  projectMode: "light" | "dark";
  onFramesChanged?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const effectiveWidth = computeFrameSize(devicePreset);

  async function renameFrame() {
    const name = window.prompt("New frame name:", frame.name);
    if (!name) return;
    try {
      const res = await fetch(`/api/projects/${projectSlug}/frames/${frame.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`rename failed: ${res.status}`);
      onFramesChanged?.();
    } catch (err) {
      console.error("Frame rename failed:", err);
    }
  }

  async function duplicateFrame() {
    // TODO C2 follow-up: backend for duplicate is out of scope for this task.
  }

  async function removeFrame() {
    if (!window.confirm(`Delete frame "${frame.name}"?`)) return;
    try {
      const res = await fetch(`/api/projects/${projectSlug}/frames/${frame.slug}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`delete failed: ${res.status}`);
      onFramesChanged?.();
    } catch (err) {
      console.error("Frame delete failed:", err);
    }
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ flex: "none" }}
    >
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
        {hover && (
          <div style={{ position: "absolute", top: 8, right: 8 }}>
            <FrameCornerMenu
              onRename={renameFrame}
              onDuplicate={duplicateFrame}
              onDelete={removeFrame}
            />
          </div>
        )}
      </div>
    </div>
  );
}
