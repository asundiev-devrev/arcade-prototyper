import { DotInRightWindow, IconButton } from "@xorkavi/arcade-gen";

export function CanvasToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      aria-label="Toggle canvas panel"
      variant={active ? "primary" : "secondary"}
      onClick={onToggle}
    >
      <DotInRightWindow size={16} aria-hidden="true" />
    </IconButton>
  );
}
