/**
 * ChatMessages — conversation transcript composite for Computer / Agent Studio.
 *
 * Matches Figma "chat" (node 161:9716 in the "Untitled" prototype file).
 * The transcript contains two kinds of blocks:
 *
 *   - Sender / receiver bubbles — use the arcade `<ChatBubble variant="user" />`
 *     / `<ChatBubble variant="assistant" />` component directly.
 *   - `ChatMessages.Agent` — agent's turn: a pause/running icon, an optional
 *     expandable "Thoughts" block, and body text below.
 *
 * The thoughts block (collapsed + expanded) follows Figma `_Thoughts`
 * component set 6064:65430 — a rounded pill + small detached circle
 * drawn as a thought-cloud. Geometry taken verbatim from the Figma SVG
 * export.
 *
 * Usage:
 *
 *   <ChatMessages>
 *     <ChatBubble variant="user">Help me create a presentation…</ChatBubble>
 *     <ChatBubble variant="assistant">Sure — what's the topic?</ChatBubble>
 *     <ChatMessages.Agent
 *       thoughts={<ChatMessages.Thoughts label="Thought for 4s" />}
 *     >
 *       I've drafted a slide outline based on our conversation…
 *     </ChatMessages.Agent>
 *     <ChatMessages.Agent
 *       thoughts={
 *         <ChatMessages.Thoughts label="Working" expanded>
 *           <ChatMessages.ThoughtItem subtitle="design.md">
 *             Searching for files
 *           </ChatMessages.ThoughtItem>
 *         </ChatMessages.Thoughts>
 *       }
 *     >
 *       Working on it now…
 *     </ChatMessages.Agent>
 *   </ChatMessages>
 */
import { useState, type ReactNode } from "react";
import { ChevronDownSmall, ChevronRightSmall } from "@xorkavi/arcade-gen";

/* ─── Root ──────────────────────────────────────────────────────────────── */

type RootProps = { children: ReactNode };

function Root({ children }: RootProps) {
  return <div className="flex flex-col gap-6 px-4 py-4">{children}</div>;
}

/* ─── Agent response ────────────────────────────────────────────────────── */

type AgentProps = {
  thoughts?: ReactNode;
  children?: ReactNode;
};

function Agent({ thoughts, children }: AgentProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-1">
        <span className="shrink-0 flex items-center justify-center w-6 h-6 text-(--fg-neutral-prominent)">
          <PauseGlyph />
        </span>
        {thoughts}
      </div>
      {children ? (
        <div className="text-body text-(--fg-neutral-prominent) max-w-[640px]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <rect x="3" y="2" width="2.5" height="10" rx="0.8" />
      <rect x="8.5" y="2" width="2.5" height="10" rx="0.8" />
    </svg>
  );
}

/* ─── Thoughts block ────────────────────────────────────────────────────── */
/**
 * A "thought cloud" bubble: rounded pill + small detached circle at the
 * bottom-left. Collapsed state shows a label + chevron-right; expanded
 * state adds a vertical list of `ThoughtItem`s below the header and
 * swaps the chevron to chevron-down. Matches Figma 6064:65430
 * (collapsed) / 6069:121728 (expanded).
 *
 * Geometry (collapsed, from Figma node 6064:65429):
 *   - HUG sizing, height 28px
 *   - padding left 12, right 8, top/bottom 6
 *   - corner radius 14 (pill)
 *   - 11px label text + 16×16 chevron frame (chevron right)
 *   - border colour → --stroke-neutral-subtle
 *   - fill colour → --bg-neutral-subtle
 *
 * Geometry (expanded, from Figma node 6069:121728):
 *   - HUG sizing, minWidth 240
 *   - padding left 12, right 32, top/bottom 8
 *   - itemSpacing 6 between header and items, items gap 2
 *   - corner radius 14
 *   - 11px header text + 16×17 chevron frame (chevron down)
 */

type ThoughtsProps = {
  label: ReactNode;
  expanded?: boolean;
  defaultExpanded?: boolean;
  children?: ReactNode;
};

function Thoughts({ label, expanded, defaultExpanded, children }: ThoughtsProps) {
  const controlled = typeof expanded === "boolean";
  const [internalOpen, setInternalOpen] = useState(defaultExpanded ?? false);
  const open = controlled ? (expanded as boolean) : internalOpen;

  return (
    <div className="relative inline-block self-start">
      <div
        className={[
          "relative rounded-[14px] border border-(--stroke-neutral-subtle) bg-(--surface-overlay)",
          open
            ? "flex flex-col gap-1.5 min-w-[240px] pl-3 pr-8 pt-2 pb-2"
            : "inline-flex items-center gap-0.5 pl-3 pr-2 pt-1.5 pb-1.5",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => {
            if (!controlled) setInternalOpen((v) => !v);
          }}
          className={[
            "flex items-center gap-0.5 text-system-small leading-4",
            open
              ? "text-(--fg-neutral-prominent)"
              : "text-(--fg-neutral-subtle) hover:text-(--fg-neutral-prominent)",
          ].join(" ")}
        >
          <span>{label}</span>
          <span className="inline-flex items-center justify-center w-4 h-4">
            {open ? (
              <ChevronDownSmall size={16} className="w-4 h-4" />
            ) : (
              <ChevronRightSmall size={16} className="w-4 h-4" />
            )}
          </span>
        </button>
        {open && children ? (
          <div className="flex flex-col gap-0.5">{children}</div>
        ) : null}
      </div>
      <ThoughtCloudDecoration />
    </div>
  );
}

/**
 * Thought-cloud decoration — replaces the pill's bottom-left corner arc
 * with an outward-bulging "cloud bump" that merges with the pill body,
 * plus a small detached tail circle below-left. Geometry is the verbatim
 * cubic-Bezier path from Figma 6064:65418 (main bubble) and tail circle
 * from 6064:65420.
 *
 * Anchoring:
 *   SVG is positioned at `left: -6, bottom: -6` so SVG-local (6, pill_H)
 *   aligns with the pill's exterior bottom-left corner. Because both the
 *   bump connect-points and the tail are measured relative to that corner,
 *   the decoration is self-contained and works at any pill height — so
 *   the same decoration renders correctly on both the collapsed and
 *   expanded Thoughts bubbles.
 *
 * Coordinates (SVG-local = Figma-local − (4.75, 0) + (6, pill_H − 28)):
 *   bump top-connect     pill (0.64, 18.20) → SVG (6.64, 4.20)
 *   bump bottom-bulge    pill (2.72, 27.62) → SVG (8.73, 13.62)
 *   bump left-bulge      pill (−0.31, 19.69) → SVG (5.69, 5.69)
 *   bump bottom-connect  pill (8.72, 26.97) → SVG (14.72, 12.97)
 *   tail centre          pill (−2.75, 25.17) → SVG (3.25, 11.17), r=2
 *
 * Layers (painted back-to-front):
 *   1. Filled leaf bounded by the bump curve (outer edge) and the chord
 *      from bump-bottom-connect to bump-top-connect (inner edge). The
 *      chord sits inside the pill, so closing with `Z` produces a region
 *      that covers the pill's original corner stroke AND fills the bump
 *      bulge outside the pill with the bubble's surface colour.
 *   2. Stroked bump outline (open path, no Z) in the pill's border colour.
 *   3. Small detached tail circle.
 */
/**
 * Renders the cloud-bump bulge at the pill's bottom-left corner plus the
 * detached tail dot. Uses the exact cubic-Bezier path from the Figma
 * export (node 6064:65418), so the bump curve is pixel-accurate.
 *
 * The SVG is sized 20×20 and anchored at (-6, -6) from the pill. In
 * SVG-local coordinates:
 *   - pill-corner   = (6, 14)         [pill's exterior bottom-left corner]
 *   - bump-top      = (6.69, 6.20)    [where bump curve leaves the pill's left edge]
 *   - bump-bottom   = (14.72, 14.97)  [where bump curve re-enters the pill's bottom edge]
 *   - tail centre   = (1.25, 13.17), r = 1.8
 *
 * The fill path closes the bump curve through the pill's interior so that
 * (a) the pill's own rounded-corner stroke is painted over by white, and
 * (b) the bump bulge outside the pill is filled with white — producing the
 * merged cloud silhouette.
 */
function ThoughtCloudDecoration() {
  const bumpStroke =
    "M 6.69 6.20 " +
    "C 6.31 6.64, 5.99 7.14, 5.74 7.69 " +
    "C 4.39 10.72, 5.75 14.27, 8.77 15.62 " +
    "C 10.81 16.52, 13.09 16.20, 14.77 14.97";
  const bumpFill = bumpStroke + " L 6.69 14.97 L 6.69 6.20 Z";
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width="20"
      height="20"
      className="pointer-events-none absolute"
      style={{ bottom: -6, left: -6, overflow: "visible" }}
    >
      <path d={bumpFill} fill="var(--surface-overlay)" />
      <path
        d={bumpStroke}
        fill="none"
        stroke="var(--stroke-neutral-subtle)"
        strokeWidth="1"
      />
      <circle
        cx="1.65"
        cy="13.17"
        r="1.8"
        fill="var(--surface-overlay)"
        stroke="var(--stroke-neutral-subtle)"
        strokeWidth="1"
      />
    </svg>
  );
}

/* ─── Thought item ──────────────────────────────────────────────────────── */
/**
 * A single row inside the expanded Thoughts bubble. Matches Figma
 * `_Thought Item` (6069:121781 completed, 6069:121782 in-progress).
 *
 * Each row is 20px tall with a 16×16 leading icon slot that contains a
 * 6×6 rounded square (the "filled checkmark" indicator). For an
 * in-progress row (`status="loading"`) the square animates a pulse.
 * The label is 11px `--fg-neutral-prominent`; the optional subtitle is
 * 11px `--fg-neutral-tertiary`. itemSpacing between label + subtitle
 * is 2px (counterAxisAlignItems: CENTER).
 */

type ThoughtItemProps = {
  subtitle?: ReactNode;
  status?: "done" | "loading";
  children: ReactNode;
};

function ThoughtItem({ subtitle, status = "done", children }: ThoughtItemProps) {
  const loading = status === "loading";
  return (
    <div className="flex items-center gap-0.5 h-5">
      <span
        aria-hidden
        className="shrink-0 inline-flex items-center justify-center w-4 h-4"
      >
        <span
          className={[
            "block w-1.5 h-1.5 rounded-[1px] bg-(--fg-neutral-prominent)",
            loading ? "opacity-40 animate-pulse" : "",
          ].join(" ")}
        />
      </span>
      <span
        className={[
          "text-system-small leading-4",
          loading
            ? "text-(--fg-neutral-prominent) bg-clip-text"
            : "text-(--fg-neutral-prominent)",
        ].join(" ")}
      >
        {children}
      </span>
      {subtitle ? (
        <span className="ml-0.5 text-system-small leading-4 text-(--fg-neutral-tertiary)">
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}

/* ─── Compound export ───────────────────────────────────────────────────── */

export const ChatMessages = Object.assign(Root, {
  Agent,
  Thoughts,
  ThoughtItem,
});
