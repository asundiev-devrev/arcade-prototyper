/**
 * PickerModal — tabbed picker dialog with a search field and a card grid body.
 *
 * Matches the Figma "Agent Capabilities" modal (AS-MCP, node 9793:16889): a
 * large dialog whose header row carries a tab bar on the left and a search
 * field on the right, and whose body is a grid of selectable EntityCards that
 * swaps per active tab.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Agent Capabilities                                    ✕   │
 *   │  Skills  Workflows  Tools  Connectors      [ 🔍 Search ]   │  ← tab bar + search
 *   ├──────────────────────────────────────────────────────────┤
 *   │  ┌────────┐ ┌────────┐ ┌────────┐                         │
 *   │  │ card   │ │ card   │ │ card   │   ← CardGrid per tab     │
 *   │  └────────┘ └────────┘ └────────┘                         │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - Wraps the production `Modal` at `size="lg"` (the wide picker; Figma content
 *   ≈ 881px). Header holds the title; the tab+search row sits in the body top.
 * - Uses the production `Tabs` compound for the tab bar and a search `Input`
 *   with a leading magnifier — never a hand-rolled tab strip.
 * - `tabs` is an array of `{ value, label, content }`. The body renders the
 *   active tab's `content` (typically a `CardGrid` of `EntityCard`s).
 * - Search is presentational by default (the prototype rarely needs live
 *   filtering); pass `onSearch` to wire it.
 *
 * Slots:
 * - `title` / `subtitle` — header text.
 * - `tabs` — `{ value, label, content }[]`. First tab is active by default.
 * - `searchPlaceholder` — search field placeholder.
 *
 * @counterexample Do NOT hand-roll the tab strip with styled divs. Pass `tabs`;
 *   the composite renders the production `Tabs`.
 * @counterexample Do NOT put a footer with Cancel/Save here unless the design
 *   has one — the capability picker commits on card click. Use `FormModal` for
 *   form dialogs with a footer.
 * @counterexample Do NOT set `size` — the picker is always the wide `lg` modal.
 *
 * @tokens
 * | Element | Token |
 * | Search field | arcade `Input` defaults |
 * | Tab bar | arcade `Tabs` defaults |
 */
import { type ReactNode } from "react";
import { Modal, Tabs, Input, MagnifyingGlass } from "@xorkavi/arcade-gen";

type PickerTab = {
  value: string;
  label: string;
  content: ReactNode;
};

type PickerModalProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  tabs: PickerTab[];
  searchPlaceholder?: string;
  onSearch?: (value: string) => void;
  /** Optional filter control rendered between the tabs and the search field
   *  (e.g. an "All categories" Select). Matches the Figma header row. */
  filter?: ReactNode;
};

export function PickerModal({
  open,
  onOpenChange,
  title,
  subtitle,
  tabs,
  searchPlaceholder = "Search",
  onSearch,
  filter,
}: PickerModalProps) {
  const first = tabs[0]?.value;
  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content size="lg">
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
          {subtitle && <Modal.Description>{subtitle}</Modal.Description>}
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <Tabs.Root defaultValue={first}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <Tabs.List>
                {tabs.map((t) => (
                  <Tabs.Trigger key={t.value} value={t.value}>
                    {t.label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              <div className="flex shrink-0 items-center gap-2">
                {filter}
                <div className="w-[200px]">
                  <Input
                    placeholder={searchPlaceholder}
                    iconLeft={<MagnifyingGlass size={16} />}
                    onChange={(e) => onSearch?.(e.currentTarget.value)}
                  />
                </div>
              </div>
            </div>
            {tabs.map((t) => (
              <Tabs.Content key={t.value} value={t.value}>
                {t.content}
              </Tabs.Content>
            ))}
          </Tabs.Root>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
