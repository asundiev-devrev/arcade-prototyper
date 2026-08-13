/**
 * ChatMessages — conversation transcript composite for Computer / Agent Studio.
 *
 * Matches Figma "chat" (node 161:9716 in the "Untitled" prototype file).
 * The transcript contains two kinds of blocks:
 *
 *   - Sender / receiver bubbles — use the arcade `<ChatBubble variant="sender" />`
 *     / `<ChatBubble variant="receiver" />` component directly.
 *   - `ChatMessages.Agent` — agent's turn: a pause/running icon, an optional
 *     expandable "Thoughts" block, and body text below.
 *
 * Real message bodies (DevRev timeline entries, API responses) are markdown.
 * Wrap them in `<Markdown>` so `**bold**` / `` `code` `` / `> quotes` render
 * as rich text instead of literal characters:
 *   <ChatBubble variant="receiver"><Markdown>{msg.body}</Markdown></ChatBubble>
 * Hand-written copy can stay plain text.
 *
 * The thoughts block (collapsed + expanded) follows Figma `_Thoughts`
 * component set 6064:65430 — a rounded pill + small detached circle
 * drawn as a thought-cloud. Geometry taken verbatim from the Figma SVG
 * export.
 *
 * Usage:
 *
 *   <ChatMessages>
 *     <ChatBubble variant="sender">Help me create a presentation…</ChatBubble>
 *     <ChatBubble variant="receiver">Sure — what's the topic?</ChatBubble>
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
import { type ReactNode } from "react";
import {
  ThinkingBlock,
  ThoughtStep,
  ThumbsUp,
  ThumbsDown,
  TwoSquaresOverlapping,
  IconButton,
} from "@xorkavi/arcade-gen";

/* ─── Root ──────────────────────────────────────────────────────────────── */

type RootProps = { children: ReactNode };

function Root({ children }: RootProps) {
  // Center the transcript in a max-width column (matches the reference
  // prototype + production: content-column max-width 860px, margin-inline auto).
  // Without this the bubbles span the whole pane — user bubbles fly to the far
  // right edge and agent text sits left-shifted. The artefact card fills 100%
  // of this column and negates the px-4 to snap flush below 900px.
  return <div className="flex flex-col gap-6 px-4 py-4 w-full max-w-[860px] mx-auto">{children}</div>;
}

/* ─── Agent response ────────────────────────────────────────────────────── */

type AgentProps = {
  thoughts?: ReactNode;
  children?: ReactNode;
};

function Agent({ thoughts, children }: AgentProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* No leading glyph. This used to render a hard-coded PAUSE bar (two
          vertical strokes) beside every thoughts block — in a static transcript
          that reads as "the agent is paused", and it appeared on every single
          agent turn. The DS ThinkingBlock carries its own affordance. */}
      {thoughts ? <div className="flex items-start">{thoughts}</div> : null}
      {children ? (
        <div className="text-body text-(--fg-neutral-prominent) max-w-[640px]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Thoughts block ────────────────────────────────────────────────────── */
/**
 * Thin wrapper over the design system's `ThinkingBlock`.
 *
 * This used to be ~200 lines of hand-traced SVG: a pill plus a "cloud bump"
 * and a detached tail dot, transcribed as verbatim cubic Béziers from an
 * "Untitled" Figma prototype file. arcade-gen 2.0 ships the real component
 * (`ThinkingBlock` + `ThoughtStep`, styled with the --component-thinking-*
 * tokens), so the traced copy was both wrong and redundant — it rendered a
 * bordered pill with a stray floating dot where the product shows a soft,
 * borderless chip.
 *
 * Rule of thumb this cost us: if arcade-gen exports it, DELEGATE. Tracing
 * geometry out of Figma is for things the design system does not ship.
 */

type ThoughtsProps = {
  label: ReactNode;
  expanded?: boolean;
  defaultExpanded?: boolean;
  /** Pulses the label while the agent is still working. */
  active?: boolean;
  children?: ReactNode;
};

function Thoughts({ label, expanded, defaultExpanded, active, children }: ThoughtsProps) {
  return (
    <ThinkingBlock
      // ThinkingBlock's label is a string; the kit's has always accepted a node.
      // Pass strings straight through and fall back for anything else.
      label={typeof label === "string" ? label : undefined}
      active={active}
      expanded={expanded}
      defaultExpanded={defaultExpanded}
    >
      {children}
    </ThinkingBlock>
  );
}

/* ─── Thought item ──────────────────────────────────────────────────────── */
/**
 * One row inside an expanded Thoughts block — now the DS `ThoughtStep`.
 * The kit's `status` vocabulary ("done" / "doing" / "todo") is kept and
 * translated, so existing frames keep working.
 */

type ThoughtItemProps = {
  subtitle?: ReactNode;
  status?: "done" | "loading" | "pending";
  children?: ReactNode;
};

// The kit's vocabulary predates the DS component's; translate rather than
// rename, so existing frames (and ComputerScene's `status="loading"`) keep working.
const STEP_STATUS = {
  done: "completed",
  loading: "active",
  pending: "pending",
} as const;

function ThoughtItem({ subtitle, status = "done", children }: ThoughtItemProps) {
  return (
    <ThoughtStep status={STEP_STATUS[status] ?? "completed"}>
      {children}
      {subtitle ? (
        <span className="text-(--fg-neutral-subtle)"> {subtitle}</span>
      ) : null}
    </ThoughtStep>
  );
}

/* ─── Actions row (feedback affordances under an assistant response) ────── */
/**
 * Copy / thumbs-up / thumbs-down cluster rendered under an assistant turn
 * on surfaces that surface feedback (Computer web). Render inside or under
 * a `<ChatMessages.Agent>` block as the last child. Each button fires an
 * optional `onCopy|onThumbUp|onThumbDown` handler; the caller owns state.
 */
type ActionsProps = {
  onCopy?: () => void;
  onThumbUp?: () => void;
  onThumbDown?: () => void;
  /** Show a filled/"selected" appearance on one of the two thumbs. */
  rating?: "up" | "down" | null;
};

function Actions({ onCopy, onThumbUp, onThumbDown, rating = null }: ActionsProps) {
  return (
    <div className="flex items-center gap-1 mt-1 text-(--fg-neutral-subtle)">
      <IconButton aria-label="Copy" variant="tertiary" size="sm" onClick={onCopy}>
        <TwoSquaresOverlapping size={16} />
      </IconButton>
      <IconButton
        aria-label="Good response"
        variant="tertiary"
        size="sm"
        onClick={onThumbUp}
        data-active={rating === "up" ? "true" : undefined}
      >
        <ThumbsUp size={16} />
      </IconButton>
      <IconButton
        aria-label="Bad response"
        variant="tertiary"
        size="sm"
        onClick={onThumbDown}
        data-active={rating === "down" ? "true" : undefined}
      >
        <ThumbsDown size={16} />
      </IconButton>
    </div>
  );
}

/* ─── Sender label (name above a third-party user's message cluster) ────── */
/**
 * A small label rendered above a message bubble cluster when it's from a
 * *different* user in a multiplayer Computer chat — e.g. "Arthur Nurse"
 * above Arthur's bubble when he @-mentions Computer in the same thread.
 * Omit for the current user's own bubbles and for the Computer agent.
 */
type SenderProps = {
  avatar?: ReactNode;
  children: ReactNode;
};

function Sender({ avatar, children }: SenderProps) {
  return (
    <div className="flex items-center gap-2 pt-2 text-caption text-(--fg-neutral-subtle)">
      {avatar ? <span className="shrink-0 w-5 h-5 inline-flex items-center justify-center">{avatar}</span> : null}
      <span className="truncate">{children}</span>
    </div>
  );
}

/* ─── Compound export ───────────────────────────────────────────────────── */

export const ChatMessages = Object.assign(Root, {
  Agent,
  Thoughts,
  ThoughtItem,
  Actions,
  Sender,
});
