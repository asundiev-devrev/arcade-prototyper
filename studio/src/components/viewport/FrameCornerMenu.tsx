import { Menu, IconButton } from "@xorkavi/arcade-gen";

export function FrameCornerMenu({
  onRename,
  onDuplicate,
  onDelete,
}: {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton aria-label="Frame actions">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </IconButton>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item onClick={onRename}>Rename</Menu.Item>
        <Menu.Item onClick={onDuplicate}>Duplicate</Menu.Item>
        <Menu.Item onClick={onDelete}>Delete</Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
