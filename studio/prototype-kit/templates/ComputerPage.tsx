/**
 * ComputerPage — Computer / Agent Studio chat-screen page template.
 *
 * Composes ComputerSidebar (with its own window chrome) + ComputerHeader +
 * a scrolling body slot + ChatInput, with an optional right-hand panel
 * (typically a CanvasPanel) as a sibling of the chat column:
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ ComputerSidebar │  ComputerHeader (title pill | actions)             │
 *   │  (own chrome,   ├─────────────────────────────────────────┬──────────┤
 *   │   New Chat,     │  body (ChatMessages / ChatEmptyState)   │  panel   │
 *   │   sessions,     │  …                                      │ (Canvas  │
 *   │   chats, user)  ├─────────────────────────────────────────┤   Panel) │
 *   │                 │  ChatInput (full-width, bottom-flush)   │          │
 *   └─────────────────┴─────────────────────────────────────────┴──────────┘
 *
 * Why a template, not a composite: like SettingsPage / VistaPage, this
 * encodes the *relationship* between the Computer composites. A generated
 * Computer frame collapses from ~250 hand-rolled lines (including window
 * chrome, sidebar, message area, composer, optional details rail) to ~40
 * declarative slots.
 *
 * Intentional opinions:
 * - The template does NOT use AppShell. ComputerSidebar already owns the
 *   window chrome (traffic lights, collapse, nav arrows) — wrapping it in
 *   AppShell would stack two title bars. The outer flex row + window
 *   surface is owned here.
 * - The body is ALWAYS scrollable, ALWAYS bordered above the ChatInput
 *   (top border on ChatInput) and below the ComputerHeader (no border —
 *   header sits flush against the body surface). Don't add your own.
 * - `chatInput` is a separate slot from `children` because it never lives
 *   inside the scrolling body — it sits below it as a sibling of the
 *   scroll container, full-width.
 * - `panel` is the right-hand side panel (CanvasPanel by convention). When
 *   omitted, the chat column fills the full width to the right of the
 *   sidebar. The panel supplies its own border-l / surface tokens.
 *
 * Slots:
 * - `sidebar` (required) — typically <ComputerSidebar>…</ComputerSidebar>.
 * - `header` (required) — typically <ComputerHeader title="…" actions={…} />.
 * - `chatInput` (required) — typically <ChatInput trailing={…} />.
 * - `children` — body content. Typically <ChatMessages>…</ChatMessages> for
 *   an active conversation, or <ChatEmptyState /> for a fresh chat.
 * - `panel` (optional) — right-hand artefacts panel (CanvasPanel by
 *   convention). When omitted, no right rail is rendered.
 *
 * @counterexample Do NOT also pass a TitleBar (via AppShell or directly). ComputerSidebar OWNS the window chrome; doubling up stacks two title bars. The chat column is deliberately chromeless above the ComputerHeader.
 * @counterexample Do NOT wrap the ChatInput in extra padding or a max-width column. It is designed to be full-width and bottom-flush; padding lives inside the composite.
 * @counterexample Do NOT render the chat body inside a max-width="640" wrapper at the template level — `ChatMessages` and its message bubbles already cap their own widths. The scroll container should fill the chat column so the empty-state wordmark centers correctly.
 * @counterexample Do NOT re-implement `ComputerPage` locally in the frame (`function ComputerPage(…) { return <div className="flex">…</div> }`). Import it from `arcade-prototypes`. Same for `ComputerSidebar`, `ComputerHeader`, `ChatInput`, `ChatMessages`, `ChatEmptyState`, `CanvasPanel`.
 * @counterexample Do NOT use `SettingsPage` or `VistaPage` for a Computer chat screen — those wire DevRev SoR chrome (TitleBar + NavSidebar + breadcrumb / VistaHeader + VistaToolbar). Computer screens have a fundamentally different shape: chat-style sidebar, conversation header, scrolling transcript, command bar.
 *
 * @tokens Canvas tokens most likely to be referenced inside the body slot:
 *
 * | Intent                      | Token                           |
 * |---|---|
 * | Body surface                | `--surface-overlay` (already applied by template) |
 * | Sidebar surface             | `--surface-shallow` (already applied via ComputerSidebar) |
 * | Window backdrop             | `--surface-backdrop`            |
 * | Divider / border            | `--stroke-neutral-subtle`       |
 *
 * The root is a `@container` element; descendants can query its width. The canvas panel auto-converts from a docked column to a fixed overlay drawer below 600px container width.
 */
import type { ReactNode } from "react";
import { IconButton, CrossSmall } from "@xorkavi/arcade-gen";

export const COMPUTER_LAYOUT = {
  RAIL_WIDTH: 64,
  SIDENAV_EXPANDED: 256,
  SIDENAV_OVERLAY: 360,
  CANVAS_WIDTH: 320,
  THRESHOLD_NO_CANVAS: 600,
  THRESHOLD_WITH_CANVAS: 900,
  CANVAS_DRAWER_BELOW: 600,
  MAIN_MIN: 260,
} as const;

type ComputerPageProps = {
  sidebar: ReactNode;
  header: ReactNode;
  chatInput: ReactNode;
  children: ReactNode;
  panel?: ReactNode;
  /** Called when the user dismisses the canvas drawer (backdrop click or the
   *  drawer's close button) — only reachable below 600px where the canvas is
   *  an overlay. Typically flips the canvas-open state in the caller. */
  onCanvasClose?: () => void;
};

export function ComputerPage({
  sidebar,
  header,
  chatInput,
  children,
  panel,
  onCanvasClose,
}: ComputerPageProps) {
  const hasPanel = panel != null;
  return (
    <div className="@container relative flex h-screen w-full bg-(--surface-backdrop) overflow-hidden">
      {sidebar}
      <div className="flex-1 min-w-0 flex flex-col h-full bg-(--surface-overlay)">
        {header}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        {chatInput}
      </div>
      {hasPanel ? (
        <>
          {/* Docked canvas at wide container widths; hidden below 600px. */}
          <div className="shrink-0 @max-[600px]:hidden">{panel}</div>
          {/* Below 600px the same panel becomes an overlay drawer (backdrop +
              right-pinned panel). Use `absolute` — the root is `relative` AND a
              `container-type` element, which establishes a containing block for
              `fixed` too, so `fixed` would anchor to the root (offset by any
              outer chrome) rather than the viewport. `absolute inset-0` pins
              flush to the ComputerPage box, which is exactly the overlay scope. */}
          <div className="hidden @max-[600px]:block">
            <div
              className="absolute inset-0 z-[110] bg-black/20"
              onClick={onCanvasClose}
              aria-hidden="true"
            />
            <div className="absolute right-0 top-0 z-[120] h-full shadow-lg">
              {onCanvasClose ? (
                <IconButton
                  aria-label="Close canvas"
                  variant="tertiary"
                  size="sm"
                  onClick={onCanvasClose}
                  className="absolute right-2 top-2 z-[1] text-(--fg-neutral-prominent)"
                >
                  <CrossSmall size={16} />
                </IconButton>
              ) : null}
              {panel}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
