import { Menu, ChevronDownSmall } from "@xorkavi/arcade-gen";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  formatZoomLabel,
  nextStep,
} from "./zoomSteps";

export function ZoomIndicator({
  zoom,
  onZoomChange,
  onFitToScreen,
}: {
  zoom: number;
  onZoomChange: (next: number) => void;
  onFitToScreen: () => void;
}) {
  const label = formatZoomLabel(zoom);
  const canZoomIn = zoom < ZOOM_MAX - 1e-6;
  const canZoomOut = zoom > ZOOM_MIN + 1e-6;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 36,
        right: 36,
        zIndex: 3,
      }}
    >
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            type="button"
            aria-label={`Zoom: ${label}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
              color: "var(--fg-neutral-tertiary)",
              background: "var(--surface-overlay)",
              border: "1px solid var(--stroke-neutral-subtle)",
              borderRadius: 6,
              letterSpacing: 0.4,
              cursor: "pointer",
            }}
          >
            <span>{label}</span>
            <ChevronDownSmall size={12} aria-hidden="true" />
          </button>
        </Menu.Trigger>
        <Menu.Content align="end">
          <Menu.Item
            onSelect={() => onZoomChange(nextStep(zoom, "in"))}
            disabled={!canZoomIn}
          >
            Zoom in
          </Menu.Item>
          <Menu.Item
            onSelect={() => onZoomChange(nextStep(zoom, "out"))}
            disabled={!canZoomOut}
          >
            Zoom out
          </Menu.Item>
          <Menu.Item onSelect={() => onZoomChange(0.5)}>Zoom to 50%</Menu.Item>
          <Menu.Item onSelect={() => onZoomChange(1.0)}>Zoom to 100%</Menu.Item>
          <Menu.Item onSelect={() => onZoomChange(2.0)}>Zoom to 200%</Menu.Item>
          <Menu.Item onSelect={onFitToScreen}>Zoom to fit</Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </div>
  );
}
