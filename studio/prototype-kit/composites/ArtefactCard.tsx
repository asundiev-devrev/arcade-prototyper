/**
 * ArtefactCard — a file/document preview card embedded in an agent chat
 * message. Borrowed from the DeReGilz/responsive prototype's "artefact card":
 * a red filetype tag + title + "Open in canvas" CTA on the left, and a fanned
 * three-page thumbnail on the right.
 *
 * Responsive: the card must sit inside a `@container/chat` element (the
 * ComputerPage chat column establishes it). As the chat column narrows (e.g.
 * when the canvas docks), `--stack-scale` steps down so the thumbnail scales
 * proportionally (anchored top-right) instead of squishing, and at ≤900px the
 * card snaps flush to the column edges. All via Tailwind utilities — no CSS
 * file (the kit build is tsc-only and does not bundle CSS).
 *
 * The two expressive borrows (pink #FFE5DB surface, red #FF342D tag) are
 * deliberately confined to this composite; everywhere else stays on DevRev
 * arcade-gen tokens.
 *
 * Usage:
 *   <ChatMessages.Agent thoughts={…}>
 *     Here's the launch brief I drafted:
 *     <ArtefactCard tag="DOC" title="Q3 launch brief" onOpen={() => openCanvas()} />
 *   </ChatMessages.Agent>
 */
import { Document } from "@xorkavi/arcade-gen";

export type ArtefactCardProps = {
  /** Filetype label shown in the red tag pill, e.g. "DOC". */
  tag: string;
  /** Document title. */
  title: React.ReactNode;
  /** "Open in canvas" CTA handler. When omitted, the CTA is not rendered. */
  onOpen?: () => void;
};

// One reusable page-layer box (fanned thumbnail). `tone` sets the wash.
function PageLayer({
  className,
  tone,
  children,
}: {
  className: string;
  tone: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`absolute right-0 top-0 w-[316px] aspect-[573/692] rounded-[6px] shadow-[0_8px_24px_rgba(0,0,0,0.10)] ${className}`}
      style={{ background: tone }}
    >
      {children}
    </div>
  );
}

export function ArtefactCard({ tag, title, onOpen }: ArtefactCardProps) {
  return (
    <div
      className={[
        // base layout + the expressive pink surface
        "relative flex min-h-[152px] overflow-hidden rounded-[4px] px-5",
        "bg-[#FFE5DB]",
        // --stack-scale step-down — DESCENDING px order so narrowest wins
        "[--stack-scale:1]",
        "@max-[900px]/chat:[--stack-scale:0.92]",
        "@max-[820px]/chat:[--stack-scale:0.82]",
        "@max-[680px]/chat:[--stack-scale:0.7]",
        "@max-[540px]/chat:[--stack-scale:0.58]",
        "@max-[420px]/chat:[--stack-scale:0.5]",
        // snap-to-edges at ≤900px (ChatMessages.Root pads px-4 = 16px)
        "@max-[900px]/chat:rounded-none",
        "@max-[900px]/chat:w-[calc(100%+32px)]",
        "@max-[900px]/chat:-mx-4",
      ].join(" ")}
    >
      {/* Left column: tag · title · CTA */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 py-5">
        <div className="flex items-center gap-1.5 text-[13px] font-mono uppercase tracking-tight text-[#FF342D]">
          <Document size={16} />
          <span>{tag}</span>
        </div>
        <div className="text-body-large font-semibold text-(--fg-neutral-prominent)">
          {title}
        </div>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            // Solid translucent-dark fill (prototype value rgba(62,60,61,0.09)) —
            // DevRev neutral-subtle control tokens are near-invisible on the pink
            // surface, so the CTA used a literal fill here for contrast.
            className="mt-1 inline-flex h-7 w-fit items-center rounded-[4px] bg-[rgba(62,60,61,0.09)] px-3 text-body-small text-(--fg-neutral-prominent) hover:bg-[rgba(62,60,61,0.14)]"
          >
            Open in canvas
          </button>
        ) : null}
      </div>

      {/* Right column: fanned thumbnail; flex-basis scales with --stack-scale.
          The fan intentionally bleeds off the card's right edge (clipped by the
          card's overflow-hidden) — same as the prototype. The back layers are
          PALE pink washes (≈70–75% white over the red) so the clipped edge reads
          soft, and the white front page dominates the visible area. */}
      <div className="relative flex-[0_0_calc(410px*var(--stack-scale))]">
        <div className="absolute right-0 top-4 h-full w-[410px] origin-top-right scale-[var(--stack-scale)]">
          <PageLayer className="rotate-[4deg]" tone="rgba(255,52,45,0.16)" />
          <PageLayer className="-rotate-[3deg]" tone="rgba(255,52,45,0.12)" />
          <PageLayer className="-rotate-[6deg] !shadow-[0_12px_32px_rgba(0,0,0,0.14)]" tone="#FFFFFF">
            {/* miniature replica scene */}
            <div className="flex h-full flex-col gap-2 p-5">
              <Document size={20} />
              <div className="h-3 w-3/4 rounded-[2px] bg-(--surface-shallow)" />
              <div className="h-px w-full bg-(--stroke-neutral-subtle)" />
              <div className="h-2 w-full rounded-[2px] bg-(--surface-shallow)" />
              <div className="h-2 w-5/6 rounded-[2px] bg-(--surface-shallow)" />
              <div className="h-2 w-2/3 rounded-[2px] bg-(--surface-shallow)" />
            </div>
          </PageLayer>
        </div>
      </div>
    </div>
  );
}
