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
 * Live DOM reference (app.devrev.ai/devrev/views/… , verified 2026-06-03):
 *   Row: h-12 (48px), border-b --stroke-neutral-subtle, hover
 *     --control-bg-neutral-subtle-hover, items-center. Cells own px-2 with a
 *     12px row inset (pl-3 pr-3). Cell text is 12px (text-body-small).
 *   Header: h-8 (32px), text-system-small + --fg-neutral-subtle, NOT
 *     uppercase. (The real app de-uppercased headers; the old caption/upper
 *     treatment was kit drift.)
 *
 * Layout:
 *
 *   ┌─ pl-3 ─┬────────┬─── flex-1 ───┬──────────┬──────────┬──────────┐
 *   │ select │  id    │  title       │  owner   │  stage   │  date    │
 *   └────────┴────────┴──────────────┴──────────┴──────────┴──────────┘
 *
 * Column components encode token choices so callers can't drift. The real
 * vista is PLAINER than this composite used to be — the only colour is the
 * ObjectId badge and a tiny stage icon; everything else is neutral text.
 *   - <VistaRow.Priority value="P0" /> — Tag, intent mapped from P0..P3.
 *     (Priority is per-view; many vistas don't show it.)
 *   - <VistaRow.Id>ENH-7267</VistaRow.Id> — ObjectId badge: soft type-tinted
 *     pill (default success/green; pass `intent` for issues=info, etc.).
 *     ChipText, NOT mono, NOT a blue Tag.
 *   - <VistaRow.Title>…</VistaRow.Title> — truncating body-small-prominent.
 *   - <VistaRow.Stage>Ideation</VistaRow.Stage> — small status icon + PLAIN
 *     neutral text. NOT a colored tag. Pass `icon` to override the glyph.
 *   - <VistaRow.Part>Identity / SSO</VistaRow.Part> — text-body-small medium fg.
 *   - <VistaRow.Owner name="Priya Shah" /> — Avatar + name.
 *   - <VistaRow.Tags tags={["regression", "enterprise"]} /> — neutral tinted Tags.
 *   - <VistaRow.Updated>May 27, 2026</VistaRow.Updated> — text-caption subtle.
 *
 * Intentional opinions:
 * - The row is `items-center`, not `items-baseline`.
 * - The row does NOT own its columns' widths. Callers decide: most vista
 *   tables use `w-24` for ID, `flex-1 min-w-0` for Title, `w-40` for
 *   Stage/Part/Owner, `w-28` for Updated. Header cells use the same widths.
 * - The HeaderCell subcomponent shares the row cell's width+padding
 *   invariants so header and body columns stay aligned.
 *
 * @counterexample Do NOT use `arcade.Table` for a vista list view — it's a generic data table and won't produce the DevRev vista row shape.
 * @counterexample Do NOT hand-roll `<div className="flex items-center h-12 …">` rows. Use `<VistaRow>` and the column primitives so every vista looks identical.
 * @counterexample Do NOT render the Stage column as a colored Tag — the real app shows a small status icon + plain neutral text. Use `<VistaRow.Stage>`.
 * @counterexample Do NOT render the ID as a blue mono Tag — it's a soft type-tinted ObjectId badge (green for enhancements). Use `<VistaRow.Id>` and pass `intent` for the object type.
 */
import type { ReactNode } from "react";
import { Avatar, Tag, ClockWithDashedOutline, type TagIntent } from "@xorkavi/arcade-gen";

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
      className="flex items-center h-12 pl-3 pr-3 border-b border-(--stroke-neutral-subtle) hover:bg-(--control-bg-neutral-subtle-hover) cursor-pointer"
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
      className="flex items-center h-8 pl-3 pr-3 border-b border-(--stroke-neutral-subtle) bg-(--surface-overlay) sticky top-0 z-10"
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
        "px-2 text-system-small text-(--fg-neutral-subtle) shrink-0 truncate",
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
    <div className="w-12 px-2 shrink-0">
      <Tag intent={PRIORITY_INTENT[value]} appearance="tinted">
        {value}
      </Tag>
    </div>
  );
}

/**
 * Id — the DevRev "ObjectId" badge. A soft type-tinted pill (NOT a mono
 * Tag): enhancements render green, issues blue, tickets etc. their own
 * tint. Matches the live app: ChipText (not mono), 11px, radius-4, tight
 * 0/4px padding, subtle 10%-alpha background. `intent` picks the tint;
 * default `success` (enhancement-green) since that's the canonical demo.
 */
function Id({
  children,
  intent = "success",
  className = "w-24",
}: {
  children: ReactNode;
  intent?: "success" | "info" | "warning" | "intelligence" | "neutral";
  className?: string;
}) {
  const TINT: Record<string, string> = {
    success: "bg-(--bg-success-subtle) text-(--fg-success-prominent)",
    info: "bg-(--bg-info-subtle) text-(--fg-info-prominent)",
    warning: "bg-(--bg-warning-subtle) text-(--fg-warning-prominent)",
    intelligence: "bg-(--bg-intelligence-subtle) text-(--fg-intelligence-prominent)",
    neutral: "bg-(--bg-neutral-subtle) text-(--fg-neutral-prominent)",
  };
  return (
    <div className={`px-2 shrink-0 ${className}`}>
      <span
        className={`inline-flex items-center rounded-square px-1 text-caption ${TINT[intent]}`}
      >
        {children}
      </span>
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
    <div className="flex-1 min-w-0 px-2 flex items-center gap-2">
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

/**
 * Stage — small status icon + PLAIN neutral text. The live DevRev vista
 * does NOT render stage as a colored tag (that was kit drift); it shows a
 * tiny status glyph followed by the stage name in neutral text. The `tone`
 * prop is accepted for API compatibility but no longer drives a tag colour;
 * pass a custom `icon` to override the default clock glyph.
 */
function Stage({
  children,
  icon,
  className = "w-40",
}: {
  /** Accepted for back-compat; no longer maps to a tag colour. */
  tone?: StageTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-2 shrink-0 flex items-center gap-1.5 min-w-0 text-body-small text-(--fg-neutral-prominent) ${className}`}
    >
      <span className="shrink-0 text-(--fg-neutral-subtle) flex items-center">
        {icon ?? <ClockWithDashedOutline size={14} />}
      </span>
      <span className="truncate">{children}</span>
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
      className={`px-2 shrink-0 text-body-small text-(--fg-neutral-medium) truncate ${className}`}
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
      className={`px-2 shrink-0 flex items-center gap-2 min-w-0 ${className}`}
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
      className={`px-2 shrink-0 flex items-center gap-1 flex-wrap ${className}`}
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
      className={`px-2 shrink-0 text-caption text-(--fg-neutral-subtle) truncate ${className}`}
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
