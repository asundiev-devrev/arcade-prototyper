/**
 * FormField — labelled form control wrapper with required marker.
 *
 * Matches the Figma "Text Field" label row, which renders the field label
 * followed by a red required asterisk (e.g. "Server name*"). The production
 * arcade `Input`/`TextArea` render their own label but do NOT render the
 * required `*`, so this wrapper owns the label row and the control is passed
 * label-less as `children`.
 *
 *   Server name *           ← label + red asterisk (this composite)
 *   [ My great MCP        ] ← children (arcade Input/TextArea/Select, no label prop)
 *
 * Intentional opinions:
 * - Label uses the exact arcade input label style
 *   (`text-system-small-medium`, `--component-input-fg-label`) so a FormField
 *   label is indistinguishable from a native arcade `Input label=…`.
 * - The required `*` uses `--fg-alert-prominent` and a leading space, matching
 *   Figma's "Placeholder*" label glyph.
 * - 6px gap between label and control (Figma label→content spacing).
 *
 * Slots:
 * - `label` — field label text.
 * - `required` — when true, appends a red `*`.
 * - `children` — the control. Pass arcade controls WITHOUT their own `label`
 *   prop (this wrapper renders the label).
 *
 * @counterexample Do NOT also set `label=` on the arcade `Input` inside — you'll
 *   get two labels. The control passed as `children` must be label-less.
 * @counterexample Do NOT hardcode a red hex for the asterisk. Use this wrapper;
 *   it applies `--fg-alert-prominent`.
 *
 * @tokens
 * | Element | Token |
 * | Label text | `--component-input-fg-label` |
 * | Required asterisk | `--fg-alert-prominent` |
 */
import { type ReactNode } from "react";

type FormFieldProps = {
  label: string;
  required?: boolean;
  children: ReactNode;
};

export function FormField({ label, required, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-system-small-medium text-(--component-input-fg-label)">
        {label}
        {required && <span className="text-(--fg-alert-prominent)">{" *"}</span>}
      </label>
      {children}
    </div>
  );
}
