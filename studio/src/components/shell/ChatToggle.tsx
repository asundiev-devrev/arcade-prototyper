import { DotInLeftWindow, IconButton } from "@xorkavi/arcade-gen";

export function ChatToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      aria-label={active ? "Collapse chat panel" : "Expand chat panel"}
      variant={active ? "primary" : "tertiary"}
      onClick={onToggle}
    >
      <DotInLeftWindow size={16} aria-hidden="true" />
    </IconButton>
  );
}
