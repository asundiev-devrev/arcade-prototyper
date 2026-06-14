/**
 * FormModal — DevRev "create / configure" dialog composite.
 *
 * Matches the Figma "Modal Content" used across Connectors (Create custom MCP),
 * Settings, and Agent Studio: a centered 720px dialog with an icon-chip header,
 * a title + supporting subtitle, a vertical stack of form fields, and a
 * right-aligned footer with a Cancel + a primary submit button.
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  ◇  Create custom MCP                                 ✕   │  ← header
 *   │     Point Computer to your own MCP server to make…       │     (icon chip + title + subtitle)
 *   ├─────────────────────────────────────────────────────────┤
 *   │   [ Server name*            ]                            │  ← body
 *   │   [ Server URL*             ]                            │     (field children, 24px gap)
 *   │   [ Server description      ]                            │
 *   ├─────────────────────────────────────────────────────────┤
 *   │                                    Cancel    [ Next ]    │  ← footer (right-aligned)
 *   └─────────────────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - Wraps the production `Modal` compound (Root/Content/Header/Body/Footer) —
 *   never re-implements the overlay, shadow, blur, or animation. `size="md"`
 *   is the DevRev default (720px) and matches Figma exactly.
 * - The optional `icon` renders in a rounded chip to the left of the title,
 *   matching the "Icon" 45px chip in Figma. Pass an arcade icon element.
 * - Footer buttons are right-aligned. `submitLabel` is a primary button;
 *   Cancel is tertiary. Submit fires `onSubmit`; Cancel/✕/overlay fire
 *   `onOpenChange(false)`.
 * - Body children are the caller's form fields (arcade `<Input>`, `<TextArea>`,
 *   `<Select>` — each already renders its own label/required/helper). They are
 *   stacked vertically at 24px gap, the Figma "Content" gap.
 *
 * Slots:
 * - `title` — dialog heading (string or node).
 * - `subtitle` — supporting line under the title (optional).
 * - `icon` — leading icon element for the header chip (optional).
 * - `children` — form fields, stacked at 24px gap.
 * - `submitLabel` / `cancelLabel` — footer button text.
 *
 * @counterexample Do NOT wrap children in your own `<form>` with custom gap or
 *   padding — the composite owns the 24px field stack and the body padding.
 * @counterexample Do NOT re-create a Cancel/submit row inside `children`. Use
 *   the `onSubmit` + `submitLabel` props; the footer is built for you.
 * @counterexample Do NOT pass `text-title-*` classes to `title`/`subtitle`.
 *   The composite renders the title at the modal's body-large-bold and the
 *   subtitle at the modal description token.
 * @counterexample Do NOT hardcode the 720px width or the shadow — that lives in
 *   `Modal.Content size="md"`. Changing size is a different composite.
 *
 * @tokens
 * | Element | Token |
 * | Header icon chip bg | `--surface-shallow` |
 * | Subtitle text | `--component-modal-desc-fg` (via Modal.Description) |
 * | Body field gap | 24px (Figma "Content" itemSpacing) |
 */
import { type ReactNode } from "react";
import { Modal, Button } from "@xorkavi/arcade-gen";

type FormModalProps = {
  /** Controlled open state. */
  open?: boolean;
  /** Fired when the dialog requests to close (✕, Cancel, overlay, Esc). */
  onOpenChange?: (open: boolean) => void;
  /** Dialog heading. */
  title: ReactNode;
  /** Supporting line under the title. */
  subtitle?: ReactNode;
  /** Leading icon element rendered in the header chip. */
  icon?: ReactNode;
  /** Form fields — stacked vertically at 24px gap. */
  children: ReactNode;
  /** Primary footer button label. */
  submitLabel?: string;
  /** Secondary footer button label. */
  cancelLabel?: string;
  /** Fired when the primary button is clicked. */
  onSubmit?: () => void;
};

export function FormModal({
  open,
  onOpenChange,
  title,
  subtitle,
  icon,
  children,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  onSubmit,
}: FormModalProps) {
  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content size="md">
        <Modal.Header>
          <div className="flex items-center gap-3">
            {icon && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--surface-shallow) text-(--fg-neutral-prominent)">
                {icon}
              </span>
            )}
            <Modal.Title>{title}</Modal.Title>
          </div>
          {subtitle && <Modal.Description>{subtitle}</Modal.Description>}
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          <div className="flex flex-col gap-6">{children}</div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={() => onOpenChange?.(false)}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={onSubmit}>
            {submitLabel}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
