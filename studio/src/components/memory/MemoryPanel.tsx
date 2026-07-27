import { useState } from "react";
import {
  Button,
  IconButton,
  TextArea,
  Tag,
  Tooltip,
  TrashBin,
} from "@xorkavi/arcade-gen";
import { useMemory, type LearnedRowView, type InventoryView } from "./useMemory";

/**
 * What Studio knows about your work — and where to correct it when a frame comes
 * out wrong.
 *
 * Organised by SOURCE, not scope: what you wrote (authoritative, edit it) vs what
 * Studio inferred (a guess, delete it). That distinction is what decides what a
 * designer does with a line. Scope rides on the line as a read-only chip.
 *
 * Two things you act on, one thing you only read (existing work, in the footer).
 * Deliberately not a dashboard — nothing here demands attention.
 */
export function MemoryPanel({ projectSlug }: { projectSlug: string }) {
  const { status, data, mutationError, deleteRow, saveRule } = useMemory(projectSlug);

  if (status === "loading") {
    return <p style={{ padding: 20, fontSize: 13, color: MUTED }}>Loading…</p>;
  }
  if (status === "error" || !data) {
    return (
      <p style={{ padding: 20, fontSize: 13, color: TEXT }}>
        Couldn't load what Studio remembers.
      </p>
    );
  }

  const learned = [...data.global.rows, ...data.project.rows];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "20px 20px 32px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: TEXT }}>
        What Studio knows
      </h2>
      <p style={{ margin: "0 0 28px", fontSize: 12, lineHeight: 1.5, color: MUTED }}>
        Applied to every frame it generates. Correct anything that's wrong — changes take effect
        on your next prompt.
      </p>

      {mutationError && (
        <p
          role="status"
          style={{
            margin: "0 0 20px",
            padding: "10px 12px",
            borderRadius: 6,
            background: "var(--surface-shallow)",
            color: TEXT,
            fontSize: 13,
          }}
        >
          {mutationError}
        </p>
      )}

      <Section title="Your instructions" hint="You wrote these. Studio follows them exactly.">
        <RuleField
          label="For every project"
          text={data.global.rules}
          placeholder="e.g. Never use emoji in UI copy"
          onSave={(t) => saveRule("global", t)}
        />
        <RuleField
          label="For this project only"
          text={data.project.rules}
          placeholder="e.g. Sidebar stays collapsed by default"
          onSave={(t) => saveRule("project", t)}
        />
      </Section>

      <Section
        title="Picked up from your edits"
        hint={
          learned.length === 0
            ? "Nothing yet. Studio adds a line here when it notices you correcting the same thing."
            : "Studio inferred these. Remove anything it got wrong."
        }
      >
        {learned.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {learned.map((r) => (
              <FactRow key={r.id} row={r} onDelete={deleteRow} />
            ))}
          </ul>
        )}
      </Section>

      <ExistingWork view={data.inventory} />
    </div>
  );
}

const TEXT = "var(--fg-neutral-prominent)";
// Secondary tone — supporting copy only, never content you must read.
const MUTED = "var(--fg-neutral-soft)";
const HAIRLINE = "1px solid var(--stroke-neutral-subtle)";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TEXT }}>{title}</h3>
      <p style={{ margin: "2px 0 12px", fontSize: 12, lineHeight: 1.5, color: MUTED }}>{hint}</p>
      {children}
    </section>
  );
}

/**
 * A standing-instruction field. Uses the kit TextArea's own `label` prop so the
 * label gets the design system's styling and a real htmlFor association.
 */
function RuleField({
  label,
  text,
  placeholder,
  onSave,
}: {
  label: string;
  text: string;
  placeholder: string;
  onSave: (t: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(text);
  const dirty = draft.trim() !== text.trim();
  return (
    <div style={{ marginBottom: 16 }}>
      <TextArea
        label={label}
        value={draft}
        placeholder={placeholder}
        // Multi-line by default: these hold several sentences of standing
        // instruction, and a 2-line box made them feel like single-line inputs.
        rows={4}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
      />
      {dirty && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Button size="sm" onClick={() => onSave(draft)}>
            Save
          </Button>
          <Button size="sm" variant="tertiary" onClick={() => setDraft(text)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One inferred fact.
 *
 * Only ONE action: remove. Pinning matters only against a size cap a designer
 * will realistically never reach, and re-scoping someone else's guess is a
 * power-user move nobody asked for — both were noise on every row. Scope stays
 * visible as a read-only chip.
 */
function FactRow({
  row,
  onDelete,
}: {
  row: LearnedRowView;
  onDelete: (r: LearnedRowView) => Promise<void>;
}) {
  const [hover, setHover] = useState(false);

  return (
    <li
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 0",
        borderBottom: HAIRLINE,
      }}
    >
      {/* Bullet: the marker that makes this read as a list item rather than
          loose copy. Sized and nudged to sit on the first text line. */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 4,
          height: 4,
          marginTop: 7,
          borderRadius: "50%",
          background: MUTED,
        }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: TEXT }}>{row.fact}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
          <Tag appearance="tinted" intent="neutral">
            {row.level === "global" ? "Every project" : "This project"}
          </Tag>
          {row.hits > 1 && (
            <span style={{ fontSize: 12, color: MUTED }}>came up {row.hits} times</span>
          )}
        </div>
      </div>

      {/* Revealed on hover/focus — a destructive action shouldn't sit lit up on
          every row, but it must stay keyboard-reachable. */}
      <div
        style={{
          flexShrink: 0,
          opacity: hover ? 1 : 0,
          transition: "opacity 120ms ease",
        }}
        onFocus={() => setHover(true)}
      >
        <Tooltip content="Remove this">
          <IconButton
            size="sm"
            variant="tertiary"
            aria-label={`Remove: ${row.fact}`}
            onClick={() => onDelete(row)}
          >
            <TrashBin size={16} aria-hidden="true" />
          </IconButton>
        </Tooltip>
      </div>
    </li>
  );
}

/**
 * Reassurance, not a task: it exists so a designer can tell the agent won't
 * rebuild work that already exists. Deliberately a quiet footer rather than a
 * peer section — there is nothing here to act on, and giving it a heading
 * implied otherwise.
 */
function ExistingWork({ view }: { view: InventoryView }) {
  const [open, setOpen] = useState(false);
  const frames = view.frames.length;
  const saved = view.composites.length;

  const summary =
    frames === 0
      ? "No frames here yet, so there's nothing for Studio to reuse."
      : `Studio can also see the ${frames} ${frames === 1 ? "frame" : "frames"}${
          saved > 0 ? ` and ${saved} saved ${saved === 1 ? "component" : "components"}` : ""
        } already in this project, and reuses them instead of rebuilding.`;

  return (
    <footer style={{ marginTop: 4, paddingTop: 16, borderTop: HAIRLINE }}>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: MUTED }}>
        {summary}
        {frames > 0 && (
          <>
            {" "}
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                font: "inherit",
                color: MUTED,
                textDecoration: "underline",
              }}
            >
              {open ? "Hide" : "See what"}
            </button>
          </>
        )}
      </p>
      {open && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
          {view.frames.map((f) => (
            <li key={f.slug} style={{ padding: "5px 0", fontSize: 12, color: TEXT }}>
              {f.slug}
            </li>
          ))}
          {view.composites.length > 0 && (
            <li style={{ padding: "5px 0", fontSize: 12, color: TEXT }}>
              Saved components: {view.composites.join(", ")}
            </li>
          )}
        </ul>
      )}
    </footer>
  );
}
