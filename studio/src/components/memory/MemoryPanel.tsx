import { useState } from "react";
import {
  Button,
  IconButton,
  TextArea,
  Tag,
  Tooltip,
  TrashBin,
} from "@xorkavi/arcade-gen";
import { useMemory, type LearnedRowView } from "./useMemory";

/**
 * What Studio knows about your work — and where to correct it when a frame comes
 * out wrong.
 *
 * Organised by SOURCE, not scope: what you wrote (authoritative, edit it) vs what
 * Studio inferred (a guess, delete it). That distinction is what decides what a
 * designer does with a line. Scope rides on the line as a read-only chip.
 *
 * Only things you can act on. The project's frame/composite inventory is NOT
 * shown here — it still reaches the agent via memory/INVENTORY.md, but a list
 * the designer can't do anything with was just noise in this panel.
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

      <Section title="Rules you wrote">
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
        title="Learned from your edits"
        divider
        // Only when empty: with no rows there is nothing to infer the section's
        // purpose from, so say what will appear here.
        hint={
          learned.length === 0
            ? "Nothing yet. A line appears here when Studio notices you correcting the same thing twice."
            : undefined
        }
      >
        {learned.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {learned.map((r, i) => (
              <FactRow
                key={r.id}
                row={r}
                onDelete={deleteRow}
                last={i === learned.length - 1}
              />
            ))}
          </ul>
        )}
      </Section>
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
  divider,
  children,
}: {
  title: string;
  /** Only for empty states — a good title needs no gloss. */
  hint?: string;
  divider?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section
      style={
        divider
          ? { marginBottom: 28, paddingTop: 24, borderTop: HAIRLINE }
          : { marginBottom: 28 }
      }
    >
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TEXT }}>{title}</h3>
      {hint ? (
        <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.5, color: MUTED }}>{hint}</p>
      ) : null}
      <div style={{ marginTop: 12 }}>{children}</div>
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
  last,
}: {
  row: LearnedRowView;
  onDelete: (r: LearnedRowView) => Promise<void>;
  /** The final row draws no rule — a trailing hairline reads as a cut-off list. */
  last?: boolean;
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
        borderBottom: last ? "none" : HAIRLINE,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: TEXT }}>{row.fact}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
          <Tag appearance="tinted" intent="neutral">
            {row.level === "global" ? "Every project" : "This project"}
          </Tag>
          {row.hits > 1 && (
            <span style={{ fontSize: 12, color: MUTED }}>came up {row.hits} times</span>
          )}
          {/* There is a per-turn budget on how much memory reaches the
              generator. Without this, an over-budget row reads as active while
              it has quietly stopped applying — and the only cue would be
              frames that ignore it. */}
          {row.applied === false && (
            <span style={{ fontSize: 12, color: MUTED }}>
              not currently applied — remove older memories to make room
            </span>
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
