import { useState } from "react";
import {
  Button,
  IconButton,
  TextArea,
  Tag,
  Tooltip,
  Globe,
  Pin,
  PinFilled,
  TrashBin,
} from "@xorkavi/arcade-gen";
import { useMemory, type LearnedRowView, type InventoryView } from "./useMemory";

/**
 * What Studio knows about your work — and where to correct it when a frame comes
 * out wrong.
 *
 * Organised by SOURCE, not by scope. The only question a designer brings here is
 * "why did it do that, and is anything it believes wrong?", and the answer turns
 * on whether a line was written by them (authoritative, edit it) or inferred
 * from their edits (a guess, delete it). Scope is a chip on the line, because a
 * line's reach is a property of that line — earlier versions split the panel by
 * scope and ended up with two identical "Rules you set" headings, which is
 * unreadable.
 *
 * Deliberately not a dashboard: nothing here demands attention.
 */
export function MemoryPanel({ projectSlug }: { projectSlug: string }) {
  const { status, data, mutationError, patchRow, deleteRow, saveRule } = useMemory(projectSlug);

  if (status === "loading") {
    return <p style={{ padding: 20, fontSize: 13, color: TEXT_MUTED }}>Loading…</p>;
  }
  if (status === "error" || !data) {
    return (
      <p style={{ padding: 20, fontSize: 13, color: TEXT }}>
        Couldn't load what Studio remembers.
      </p>
    );
  }

  const learned = [...data.global.rows, ...data.project.rows];
  const frameCount = data.inventory.frames.length;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "20px 20px 40px" }}>
      {/* Orientation. Without this the panel is a list of facts with no stated
          purpose — the "what am I looking at?" failure. */}
      <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: TEXT }}>
        What Studio knows
      </p>
      <p style={{ margin: "0 0 24px", fontSize: 13, lineHeight: 1.5, color: TEXT_MUTED }}>
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

      <Section
        title="Your instructions"
        hint="You wrote these. Studio follows them exactly."
      >
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
            : "Studio inferred these. Delete anything it got wrong."
        }
      >
        {learned.length > 0 && (
          <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
            {learned.map((r) => (
              <FactRow key={r.id} row={r} onPatch={patchRow} onDelete={deleteRow} />
            ))}
          </ul>
        )}
      </Section>

      {/* Reassurance, not a work surface: it exists so you can tell the agent
          isn't about to rebuild something you already have. One line. */}
      <Section title="Your existing work">
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: TEXT }}>
          {frameCount === 0
            ? "No frames yet — nothing to reuse."
            : `Studio can see ${frameCount} ${frameCount === 1 ? "frame" : "frames"} in this project${
                data.inventory.composites.length > 0
                  ? ` and ${data.inventory.composites.length} saved ${
                      data.inventory.composites.length === 1 ? "component" : "components"
                    }`
                  : ""
              }, and will reuse them instead of rebuilding.`}
        </p>
        {frameCount > 0 && <FrameList view={data.inventory} />}
      </Section>
    </div>
  );
}

// Body text and secondary text. The secondary tone is only ever used for
// supporting copy — never for content you need to read, which is what made the
// previous version's component names inaccessible.
const TEXT = "var(--fg-neutral-prominent)";
const TEXT_MUTED = "var(--fg-neutral-soft)";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TEXT }}>{title}</h3>
      {hint && (
        <p style={{ margin: "3px 0 10px", fontSize: 12, lineHeight: 1.5, color: TEXT_MUTED }}>
          {hint}
        </p>
      )}
      {children}
    </section>
  );
}

/** A labelled standing-instruction field. The label states the reach in words. */
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
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          marginBottom: 5,
          fontSize: 12,
          color: TEXT_MUTED,
        }}
      >
        {label}
      </label>
      <TextArea
        value={draft}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
        aria-label={label}
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

function FactRow({
  row,
  onPatch,
  onDelete,
}: {
  row: LearnedRowView;
  onPatch: (
    r: LearnedRowView,
    p: { fact?: string; pinned?: boolean; toLevel?: "global" | "project" },
  ) => Promise<void>;
  onDelete: (r: LearnedRowView) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.fact);

  if (editing) {
    return (
      <li style={{ padding: "12px 0", borderTop: "1px solid var(--stroke-neutral-subtle)" }}>
        <TextArea
          value={draft}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
          aria-label={`Edit: ${row.fact}`}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Button
            size="sm"
            onClick={async () => {
              await onPatch(row, { fact: draft });
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => {
              setDraft(row.fact);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  const everywhere = row.level === "global";

  return (
    <li
      style={{
        padding: "12px 0",
        borderTop: "1px solid var(--stroke-neutral-subtle)",
      }}
    >
      <button
        onClick={() => setEditing(true)}
        aria-label={`Edit: ${row.fact}`}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          font: "inherit",
          fontSize: 13,
          lineHeight: 1.5,
          color: TEXT,
        }}
      >
        {row.fact}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <Tag appearance="tinted" intent="neutral">
          {everywhere ? "Every project" : "This project"}
        </Tag>
        {row.pinned && (
          <Tag appearance="tinted" intent="info">
            Pinned
          </Tag>
        )}
        {row.hits > 1 && (
          <span style={{ fontSize: 12, color: TEXT_MUTED, fontVariantNumeric: "tabular-nums" }}>
            came up {row.hits} times
          </span>
        )}

        <span style={{ flex: 1 }} />

        <Tooltip content={everywhere ? "Limit to this project" : "Apply to every project"}>
          <IconButton
            size="sm"
            variant="tertiary"
            aria-label={
              everywhere
                ? `Limit to this project: ${row.fact}`
                : `Apply everywhere: ${row.fact}`
            }
            onClick={() => onPatch(row, { toLevel: everywhere ? "project" : "global" })}
          >
            <Globe size={16} aria-hidden="true" />
          </IconButton>
        </Tooltip>
        <Tooltip content={row.pinned ? "Unpin — let this age out" : "Pin — always keep this"}>
          <IconButton
            size="sm"
            variant="tertiary"
            aria-label={row.pinned ? `Unpin: ${row.fact}` : `Pin: ${row.fact}`}
            onClick={() => onPatch(row, { pinned: !row.pinned })}
          >
            {row.pinned ? (
              <PinFilled size={16} aria-hidden="true" />
            ) : (
              <Pin size={16} aria-hidden="true" />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip content="Forget this">
          <IconButton
            size="sm"
            variant="tertiary"
            aria-label={`Forget: ${row.fact}`}
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
 * Collapsed by default. The frame list is evidence, not a task — it earns a
 * disclosure, not a third of the panel.
 */
function FrameList({ view }: { view: InventoryView }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          font: "inherit",
          fontSize: 12,
          color: TEXT_MUTED,
          textDecoration: "underline",
        }}
      >
        {open ? "Hide the list" : "Show the list"}
      </button>
      {open && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
          {view.frames.map((f) => (
            <li
              key={f.slug}
              style={{
                padding: "8px 0",
                borderTop: "1px solid var(--stroke-neutral-subtle)",
                fontSize: 13,
                color: TEXT,
              }}
            >
              {f.slug}
            </li>
          ))}
          {view.composites.length > 0 && (
            <li
              style={{
                padding: "8px 0",
                borderTop: "1px solid var(--stroke-neutral-subtle)",
                fontSize: 13,
                color: TEXT,
              }}
            >
              Saved components: {view.composites.join(", ")}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
