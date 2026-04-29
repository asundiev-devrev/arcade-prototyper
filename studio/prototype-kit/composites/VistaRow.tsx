/**
 * VistaRow — DevRev vista table row + canonical column vocabulary.
 *
 * Why this composite exists: generators kept inventing their own column
 * widths, paddings, and cell styles per frame. Without a canonical row,
 * every vista looked slightly different — Priority was a dot in one frame
 * and a Tag in another; ID cells drifted between `text-system-small`,
 * `text-caption`, and `font-mono`; Stage appeared as an icon strip, a
 * tinted Tag, and a soft Tag across frames generated against the same
 * Figma source. This composite encodes the production row once.
 *
 * Live DOM reference (app.devrev.ai/…/vistas/…?view_type=table):
 *   Row: h-11, border-b --stroke-neutral-subtle, hover --surface-overlay-hovered (in arcade-gen this is --control-bg-neutral-subtle-hover),
 *     items-center
 *   Column gap: the row has internal gap-0 — cells own their own px-3,
 *     with a leading 24px left indent (pl-6) to align with the group header
 *
 * Layout:
 *
 *   ┌── pl-6 ──┬──────────┬─── flex-1 ────┬──────────┬──────────┬──────────┐
 *   │ leading  │  id      │  title        │  stage   │  part    │ trailing │
 *   └──────────┴──────────┴───────────────┴──────────┴──────────┴──────────┘
 *
 * Column components encode token choices so callers can't drift:
 *   - <VistaRow.Priority value="P0" /> — Tag, intent mapped from P0..P3.
 *   - <VistaRow.Id>ISS-4231</VistaRow.Id> — tinted info Tag with mono font.
 *   - <VistaRow.Title>…</VistaRow.Title> — truncating body-small-prominent.
 *   - <VistaRow.Stage tone="info">In development</VistaRow.Stage> — tinted
 *     Tag using the tone→intent mapping (see below).
 *   - <VistaRow.Part>Identity / SSO</VistaRow.Part> — text-body-small
 *     medium fg.
 *   - <VistaRow.Owner name="Priya Shah" /> — Avatar + name.
 *   - <VistaRow.Tags tags={["regression", "enterprise"]} /> — row of
 *     neutral tinted Tags.
 *   - <VistaRow.Updated>2h ago</VistaRow.Updated> — text-caption subtle.
 *
 * Stage tone → Tag intent mapping:
 *   triage     → warning   (yellow)
 *   dev        → info      (blue)
 *   review     → intelligence (purple)
 *   queued     → neutral   (gray)
 *   done       → success   (green)
 *   blocked    → alert     (red)
 *
 * Intentional opinions:
 * - The row is `items-center`, not `items-baseline`. Baseline alignment
 *   looks broken when cells mix Tags (height 24) with plain text (h~18).
 * - The row does NOT own its columns' widths. Callers decide: most vista
 *   tables use `w-24` for ID, `flex-1 min-w-0` for Title, `w-40` for
 *   Stage/Part/Owner, `w-28` for Updated. Header cells use the same widths.
 * - The HeaderCell subcomponent exists because the column header has the
 *   same width+padding invariants as the row cell — pairing them here
 *   keeps them from drifting apart.
 *
 * @counterexample Do NOT use `arcade.Table` for a vista list view — it's a generic data table and won't produce the DevRev vista row shape.
 * @counterexample Do NOT hand-roll `<div className="flex items-center h-11 …">` rows. Use `<VistaRow>` and the column primitives so every vista looks identical.
 * @counterexample For the Priority column, use `<VistaRow.Priority value="P0" />` — don't render a colored dot + label yourself. The composite maps P0/P1/P2/P3 to Tag intents for you.
 * @counterexample For the Stage column, use `<VistaRow.Stage tone="dev">…</VistaRow.Stage>` with the tone alias (triage/dev/review/queued/done/blocked). Don't pass a raw Tag intent — the tone mapping encodes DevRev's stage-color convention.
 */
import type { ReactNode } from "react";
import { Avatar, Tag, type TagIntent } from "@xorkavi/arcade-gen";

/* ─── Root ──────────────────────────────────────────────────────────────── */

type RootProps = {
  children: ReactNode;
  onClick?: () => void;
};

function Root({ children, onClick }: RootProps) {
  return (
    <div
      role="row"
      onClick={onClick}
      className="flex items-center h-11 pl-6 pr-4 border-b border-(--stroke-neutral-subtle) hover:bg-(--control-bg-neutral-subtle-hover) cursor-pointer"
    >
      {children}
    </div>
  );
}

/* ─── Header row (matching width invariants) ────────────────────────────── */

type HeaderProps = {
  children: ReactNode;
};

function Header({ children }: HeaderProps) {
  return (
    <div
      role="row"
      className="flex items-center h-9 pl-6 pr-4 border-b border-(--stroke-neutral-subtle) bg-(--surface-overlay) sticky top-0 z-10"
    >
      {children}
    </div>
  );
}

type HeaderCellProps = {
  children: ReactNode;
  className?: string;
};

function HeaderCell({ children, className = "" }: HeaderCellProps) {
  return (
    <div
      role="columnheader"
      className={[
        "px-3 text-caption uppercase tracking-wider text-(--fg-neutral-subtle) shrink-0 truncate",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/* ─── Group header (sticky band above a group's rows) ───────────────────── */

type GroupHeaderProps = {
  label: ReactNode;
  count?: ReactNode;
  leading?: ReactNode;
};

function GroupHeader({ label, count, leading }: GroupHeaderProps) {
  return (
    <div className="sticky top-9 z-[9] flex items-center gap-2 h-9 px-6 bg-(--surface-shallow) border-b border-(--stroke-neutral-subtle)">
      {leading}
      <span className="text-system-medium text-(--fg-neutral-prominent)">
        {label}
      </span>
      {count != null ? (
        <span className="text-system text-(--fg-neutral-subtle)">{count}</span>
      ) : null}
    </div>
  );
}

/* ─── Column primitives ─────────────────────────────────────────────────── */

/** Select — leading checkbox column. Pair with a matching `<VistaRow.HeaderCell
 *  className="w-6"><Select /></…>` in the header so the column widths align.
 *  Uncontrolled by default; pass `checked` + `onChange` to drive selection. */
function Select({
  checked,
  defaultChecked,
  onChange,
  className = "w-6",
}: {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (next: boolean) => void;
  className?: string;
}) {
  return (
    <div className={`shrink-0 flex items-center justify-center ${className}`}>
      <input
        type="checkbox"
        aria-label="Select row"
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange ? (e) => onChange(e.currentTarget.checked) : undefined}
        className="h-4 w-4 cursor-pointer accent-(--bg-info-prominent)"
      />
    </div>
  );
}

type PriorityValue = "P0" | "P1" | "P2" | "P3";

const PRIORITY_INTENT: Record<PriorityValue, TagIntent> = {
  P0: "alert",
  P1: "warning",
  P2: "neutral",
  P3: "neutral",
};

function Priority({ value }: { value: PriorityValue }) {
  return (
    <div className="w-12 px-3 shrink-0">
      <Tag intent={PRIORITY_INTENT[value]} appearance="tinted">
        {value}
      </Tag>
    </div>
  );
}

function Id({
  children,
  className = "w-24",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-3 shrink-0 ${className}`}>
      <Tag intent="info" appearance="tinted">
        <span className="font-mono">{children}</span>
      </Tag>
    </div>
  );
}

function Title({
  children,
  subtitle,
}: {
  children: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex-1 min-w-0 px-3 flex items-center gap-2">
      <span className="text-body-small text-(--fg-neutral-prominent) truncate">
        {children}
      </span>
      {subtitle ? (
        <span className="text-caption text-(--fg-neutral-subtle) truncate hidden lg:inline">
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}

type StageTone =
  | "triage"
  | "dev"
  | "review"
  | "queued"
  | "done"
  | "blocked";

const STAGE_INTENT: Record<StageTone, TagIntent> = {
  triage: "warning",
  dev: "info",
  review: "intelligence",
  queued: "neutral",
  done: "success",
  blocked: "alert",
};

function Stage({
  tone,
  children,
  className = "w-40",
}: {
  tone: StageTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-3 shrink-0 ${className}`}>
      <Tag intent={STAGE_INTENT[tone]} appearance="tinted">
        {children}
      </Tag>
    </div>
  );
}

function Part({
  children,
  className = "w-48",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-3 shrink-0 text-body-small text-(--fg-neutral-medium) truncate ${className}`}
    >
      {children}
    </div>
  );
}

function Owner({
  name,
  src,
  className = "w-40",
}: {
  name: string;
  src?: string;
  className?: string;
}) {
  return (
    <div
      className={`px-3 shrink-0 flex items-center gap-2 min-w-0 ${className}`}
    >
      <Avatar name={name} src={src} size="sm" />
      <span className="text-body-small text-(--fg-neutral-prominent) truncate">
        {name}
      </span>
    </div>
  );
}

function Tags({
  tags,
  className = "w-44",
}: {
  tags: Array<{ label: string; intent?: TagIntent } | string>;
  className?: string;
}) {
  return (
    <div
      className={`px-3 shrink-0 flex items-center gap-1 flex-wrap ${className}`}
    >
      {tags.map((t) => {
        const label = typeof t === "string" ? t : t.label;
        const intent = typeof t === "string" ? "neutral" : t.intent ?? "neutral";
        return (
          <Tag key={label} intent={intent} appearance="tinted">
            {label}
          </Tag>
        );
      })}
    </div>
  );
}

function Updated({
  children,
  className = "w-28",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-3 shrink-0 text-caption text-(--fg-neutral-subtle) truncate ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── Compound export ───────────────────────────────────────────────────── */

export const VistaRow = Object.assign(Root, {
  Header,
  HeaderCell,
  GroupHeader,
  Select,
  Priority,
  Id,
  Title,
  Stage,
  Part,
  Owner,
  Tags,
  Updated,
});

export type { StageTone, PriorityValue };
