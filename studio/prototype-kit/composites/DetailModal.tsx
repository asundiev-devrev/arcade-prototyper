/**
 * DetailModal — entity detail dialog with a hero banner and a primary action.
 *
 * Matches the Figma Skill detail modal (C-Skills, node 6685:88323): a 720px
 * dialog whose top is a full-bleed hero banner (image/illustration) with the
 * close button overlaid, followed by a body of title + byline, a primary
 * action button, a divider, and a details section.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │                                            ✕   │
 *   │            ░░ hero banner ░░                    │  ← hero (full-bleed)
 *   ├──────────────────────────────────────────────┤
 *   │  List outstanding items                        │  ← title
 *   │  Extracts all open action items…               │  ← byline
 *   │  [ + Add to Computer ]                          │  ← primary action
 *   │  ──────────────────────────────────────────    │  ← divider
 *   │  Instructions                                   │  ← details section
 *   │  You are a professional copywriter…            │
 *   └──────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - Wraps the production `Modal` at `size="md"` (720px). The hero is rendered
 *   ABOVE `Modal.Header`'s usual title slot — title lives in the body so it can
 *   sit under the hero, matching Figma.
 * - The hero is full-bleed (no body padding) and clips to the modal's top
 *   corners. Pass an `<img>`, gradient div, or illustration as `hero`.
 * - `action` is a single primary button slot (e.g. "+ Add to Computer"). Pass
 *   the arcade `<Button>` directly so the caller controls label/icon/onClick.
 * - The body sections are separated by a `Separator`; `children` is the detail
 *   content (e.g. an "Instructions" block).
 *
 * Slots:
 * - `hero` — full-bleed banner node (image/gradient/illustration).
 * - `title` / `byline` — entity name + supporting line.
 * - `action` — primary button node.
 * - `children` — details section below the divider.
 *
 * @counterexample Do NOT pad or border the `hero` — it is full-bleed and
 *   corner-clipped by the composite.
 * @counterexample Do NOT pass `title` to `Modal.Header`. This composite renders
 *   the title in the body, under the hero (Figma layout).
 * @counterexample Do NOT add your own close button over the hero — the modal's
 *   `Modal.Close` is rendered for you, overlaid top-right.
 *
 * @tokens
 * | Element | Token |
 * | Title text | `--fg-neutral-prominent` |
 * | Byline text | `--fg-neutral-subtle` |
 * | Hero fallback bg | `--surface-shallow` |
 */
import { type ReactNode } from "react";
import { Modal, Separator } from "@xorkavi/arcade-gen";

type DetailModalProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hero?: ReactNode;
  title: ReactNode;
  byline?: ReactNode;
  /** Author/source row under the byline — typically a small logo + name
   *  (e.g. the DevRev mark + "DevRev"). Matches the Figma author line. */
  author?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
};

export function DetailModal({
  open,
  onOpenChange,
  hero,
  title,
  byline,
  author,
  action,
  children,
}: DetailModalProps) {
  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content size="md" className="overflow-hidden p-0">
        <div className="relative h-[200px] w-full overflow-hidden bg-(--surface-shallow)">
          {hero}
          <Modal.Close />
        </div>
        <div className="flex flex-col gap-6 p-5">
          <div className="flex flex-col gap-2.5">
            <Modal.Title className="text-title-2 text-(--fg-neutral-prominent)">
              {title}
            </Modal.Title>
            {(byline || author) && (
              <div className="flex flex-col gap-1.5">
                {byline && (
                  <Modal.Description className="text-body-medium text-(--fg-neutral-subtle)">
                    {byline}
                  </Modal.Description>
                )}
                {author && (
                  <div className="flex items-center gap-1.5 text-body-small text-(--fg-neutral-subtle)">
                    {author}
                  </div>
                )}
              </div>
            )}
            {action && <div className="pt-1.5">{action}</div>}
          </div>
          {children && (
            <>
              <Separator />
              <div>{children}</div>
            </>
          )}
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
