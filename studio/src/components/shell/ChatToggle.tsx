import { IconButton } from "@xorkavi/arcade-gen";

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
      variant={active ? "primary" : "secondary"}
      onClick={onToggle}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </IconButton>
  );
}
