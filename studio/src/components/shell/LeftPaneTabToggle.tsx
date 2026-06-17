import { ToggleGroup } from "@xorkavi/arcade-gen";
import type { LeftPaneTab } from "./LeftPaneTabs";

/**
 * The Chat/Assets switch. Lives in the header (not the pane) so it can sit
 * over the left panel, right-aligned to the panel's edge. Auto-width.
 */
export function LeftPaneTabToggle({
  tab,
  onTabChange,
}: {
  tab: LeftPaneTab;
  onTabChange: (tab: LeftPaneTab) => void;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={tab}
      // Radix single-type fires "" when the active item is re-clicked;
      // ignore the empty value so a tab is always selected.
      onValueChange={(v) => v && onTabChange(v as LeftPaneTab)}
      aria-label="Left pane view"
    >
      <ToggleGroup.Item value="chat">Chat</ToggleGroup.Item>
      <ToggleGroup.Item value="assets">Assets</ToggleGroup.Item>
    </ToggleGroup.Root>
  );
}
