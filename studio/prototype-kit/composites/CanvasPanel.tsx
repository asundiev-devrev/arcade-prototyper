/**
 * CanvasPanel — right-hand side panel for Computer / Agent Studio that
 * surfaces artefacts of the current conversation: files created by the
 * agent, local sources on the user's machine, connected external sources.
 *
 * Matches Figma node 152:5752 in the "Untitled" prototype file. Shape:
 *
 *   ┌────────────────────────────────┐
 *   │ (◐) 2 of 4 steps               │  ← step header (progress + title)
 *   │ Gather recents projects and    │
 *   │ forming an agenda              │
 *   │                                │
 *   │ Created in this topic          │  ← group
 *   │ 📄 New file.ext              ● │
 *   │ 📄 Project plan.docx         ● │
 *   │ 📄 Budget overview.xlsx        │
 *   │                                │
 *   │ On John's Macbook          +   │  ← group with trailing action
 *   │ 📁 Folder 1                    │
 *   │ 📁 Folder 2                    │
 *   │                                │
 *   │ Sources (3)                    │
 *   │ N  Notion                 [12] │  ← count badge
 *   │ G  Gmail                  [20] │
 *   │ +  Connect                     │
 *   └────────────────────────────────┘
 *
 * Intentional opinions:
 * - Fixed width (wider than a nav sidebar — ~272px). Scrolls vertically
 *   when the content overflows the viewport.
 * - Lives as a sibling of the main chat column; does NOT own window chrome
 *   (the ComputerSidebar on the left handles that).
 * - Groups are simple title + items. Titles are uppercase-less, muted
 *   ("Created in this topic", "Sources (3)"). Optional trailing `+` per
 *   group title for add-affordance.
 * - Items render leading icon (16×16) + label + optional trailing slot
 *   (status dot, count badge, action icon).
 *
 * Slots:
 * - `step` (optional) — the top step block. Pass <CanvasPanel.Step /> with
 *   `current`, `total`, and `title`. When omitted, no step header renders.
 * - `children` — <CanvasPanel.Group /> tree. Each group has a `title`,
 *   optional `trailing`, and <CanvasPanel.Item /> children.
 *
 * Compound:
 * - `CanvasPanel.Step` — the progress + title block at the top.
 * - `CanvasPanel.Group` — group title + optional trailing + children.
 * - `CanvasPanel.Item` — a single row (leading + label + trailing).
 * - `CanvasPanel.FileIcon` / `CanvasPanel.FolderIcon` / `CanvasPanel.StatusDot`
 *   / `CanvasPanel.CountBadge` — leaf helpers for common item pieces so
 *   callers don't need to inline their own SVGs or pill shapes.
 */
import type { ReactNode } from "react";
import { Document, PlusSmall } from "@xorkavi/arcade-gen";

/* ─── Root ──────────────────────────────────────────────────────────────── */

type RootProps = {
  step?: ReactNode;
  children?: ReactNode;
};

function Root({ step, children }: RootProps) {
  return (
    <aside className="flex flex-col h-full w-[272px] shrink-0 bg-(--surface-overlay) border-l border-(--stroke-neutral-subtle) overflow-y-auto">
      {step ? <div className="px-4 pt-4 pb-2">{step}</div> : null}
      <div className="flex-1 min-h-0 flex flex-col gap-1 pb-4">{children}</div>
    </aside>
  );
}

/* ─── Step header ───────────────────────────────────────────────────────── */

type StepProps = {
  current: number;
  total: number;
  title: ReactNode;
};

function Step({ current, total, title }: StepProps) {
  const progress = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  // Circumference = 2πr, with r=7 → ~43.98. Stroke-dasharray cheats the
  // progress by leaving the remainder as gap.
  const circumference = 2 * Math.PI * 7;
  const dash = progress * circumference;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="shrink-0"
        >
          <circle cx="9" cy="9" r="7" stroke="var(--stroke-neutral-subtle)" strokeWidth="1.5" />
          <circle
            cx="9"
            cy="9"
            r="7"
            stroke="var(--fg-neutral-prominent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 9 9)"
          />
        </svg>
        <span className="text-body text-(--fg-neutral-prominent)">
          {current} of {total} steps
        </span>
      </div>
      <span className="text-body text-(--fg-neutral-subtle) leading-snug">{title}</span>
    </div>
  );
}

/* ─── Group ─────────────────────────────────────────────────────────────── */

type GroupProps = {
  title?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
};

function Group({ title, trailing, children }: GroupProps) {
  return (
    <div className="flex flex-col pt-3">
      {title ? (
        <div className="flex items-center justify-between h-7 px-4">
          <span className="text-caption text-(--fg-neutral-subtle) truncate">{title}</span>
          {trailing ? <span className="shrink-0">{trailing}</span> : null}
        </div>
      ) : null}
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

/* ─── Group trailing helper ─────────────────────────────────────────────── */

function GroupAddButton({ onClick, "aria-label": ariaLabel = "Add" }: { onClick?: () => void; "aria-label"?: string }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="text-(--fg-neutral-subtle) hover:text-(--fg-neutral-prominent) p-0.5 rounded-square hover:bg-(--control-bg-neutral-subtle-hover)"
    >
      <PlusSmall size={16} />
    </button>
  );
}

/* ─── Item ──────────────────────────────────────────────────────────────── */

type ItemProps = {
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
};

function Item({ leading, trailing, children, onClick }: ItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 min-w-0 h-8 px-4 text-left text-body text-(--fg-neutral-prominent) hover:bg-(--control-bg-neutral-subtle-hover)"
    >
      {leading ? (
        <span className="shrink-0 w-4 h-4 flex items-center justify-center text-(--fg-neutral-subtle)">
          {leading}
        </span>
      ) : null}
      <span className="flex-1 min-w-0 truncate">{children}</span>
      {trailing ? (
        <span className="shrink-0 flex items-center text-caption text-(--fg-neutral-subtle)">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

/* ─── Leaf helpers ──────────────────────────────────────────────────────── */

function FileIcon() {
  return <Document size={16} />;
}

function FolderIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 5c0-.83.67-1.5 1.5-1.5h2.59c.4 0 .78.16 1.06.44L8.2 5H12.5c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5V5Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusDot() {
  return <span className="w-1.5 h-1.5 rounded-circle bg-(--fg-neutral-prominent)" aria-hidden="true" />;
}

function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-circle-x2 border border-(--stroke-neutral-subtle) bg-(--bg-neutral-soft) text-caption text-(--fg-neutral-subtle)">
      {children}
    </span>
  );
}

/* ─── Compound export ───────────────────────────────────────────────────── */

export const CanvasPanel = Object.assign(Root, {
  Step,
  Group,
  GroupAddButton,
  Item,
  FileIcon,
  FolderIcon,
  StatusDot,
  CountBadge,
});
