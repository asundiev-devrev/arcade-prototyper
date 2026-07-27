import { useState } from "react";
import { Button, IconButton, TextArea, Globe, Pin, PinFilled, TrashBin } from "@xorkavi/arcade-gen";
import { useMemory, type LearnedRowView, type InventoryView } from "./useMemory";

/**
 * What the agent knows, and where to fix it when a generation looks wrong.
 *
 * Structure encodes AUTHORITY, because that's the thing a designer needs to read
 * off this panel at a glance:
 *   - Rules are hand-written and outrank everything → they lead each block.
 *   - Learned facts are inferred and deletable → subordinate, muted, under a
 *     label that says where they came from.
 *   - Global outranks project → global block first, reach stated on every block.
 *
 * Deliberately NOT a dashboard: nothing here demands attention, and it is
 * expected to go unopened for long stretches.
 */
export function MemoryPanel({ projectSlug }: { projectSlug: string }) {
  const { status, data, mutationError, patchRow, deleteRow, saveRule } = useMemory(projectSlug);

  if (status === "loading") {
    return <p style={{ padding: 16, fontSize: 13, color: "var(--fg-neutral-subtle)" }}>Loading…</p>;
  }
  if (status === "error" || !data) {
    return (
      <p style={{ padding: 16, fontSize: 13, color: "var(--fg-neutral-subtle)" }}>
        Couldn't load what Studio remembers.
      </p>
    );
  }

  const nothingKnown =
    data.global.rows.length === 0 &&
    data.project.rows.length === 0 &&
    !data.global.rules.trim() &&
    !data.project.rules.trim();

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "16px 16px 32px" }}>
      {mutationError && (
        <p
          role="status"
          style={{
            margin: "0 0 16px",
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--surface-shallow)",
            color: "var(--fg-neutral-prominent)",
            fontSize: 13,
          }}
        >
          {mutationError}
        </p>
      )}

      {nothingKnown && (
        <p style={{ margin: "0 0 24px", fontSize: 13, lineHeight: 1.5, color: "var(--fg-neutral-subtle)" }}>
          Studio hasn't learned anything about your work yet. Write a rule below and it applies
          from the next frame on.
        </p>
      )}

      <Block reach="Every project" global title="Rules you set">
        <RuleEditor
          text={data.global.rules}
          placeholder="e.g. Never use emoji in UI copy"
          onSave={(t) => saveRule("global", t)}
        />
        <FactList rows={data.global.rows} onPatch={patchRow} onDelete={deleteRow} />
      </Block>

      <Block reach="This project only" title="Rules you set">
        <RuleEditor
          text={data.project.rules}
          placeholder="e.g. Sidebar stays collapsed by default"
          onSave={(t) => saveRule("project", t)}
        />
        <FactList rows={data.project.rows} onPatch={patchRow} onDelete={deleteRow} />
      </Block>

      <Block reach="This project only" title="Already built">
        <Inventory view={data.inventory} />
      </Block>
    </div>
  );
}

/** A reach-scoped group. Reach leads, because it IS the hierarchy signal. */
function Block({
  reach,
  global,
  title,
  children,
}: {
  reach: string;
  global?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <header style={{ marginBottom: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--fg-neutral-subtle)",
          }}
        >
          {global && <Globe style={{ width: 12, height: 12 }} aria-hidden />}
          {reach}
        </div>
        <h3
          style={{
            margin: "2px 0 0",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--fg-neutral-prominent)",
          }}
        >
          {title}
        </h3>
      </header>
      {children}
    </section>
  );
}

function FactList({
  rows,
  onPatch,
  onDelete,
}: {
  rows: LearnedRowView[];
  onPatch: (
    r: LearnedRowView,
    p: { fact?: string; pinned?: boolean; toLevel?: "global" | "project" },
  ) => Promise<void>;
  onDelete: (r: LearnedRowView) => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <p
        style={{
          margin: "0 0 4px",
          fontSize: 11,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--fg-neutral-subtle)",
        }}
      >
        Picked up from your edits
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <FactRow key={r.id} row={r} onPatch={onPatch} onDelete={onDelete} />
        ))}
      </ul>
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
      <li style={{ padding: "8px 0", borderTop: "1px solid var(--stroke-neutral-subtle)" }}>
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

  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 0",
        borderTop: "1px solid var(--stroke-neutral-subtle)",
      }}
    >
      <button
        onClick={() => setEditing(true)}
        aria-label={`Edit: ${row.fact}`}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          font: "inherit",
          fontSize: 13,
          lineHeight: 1.45,
          color: "var(--fg-neutral-prominent)",
        }}
      >
        {row.fact}
      </button>

      {/* Repeat count. Shown because a climbing number means the agent keeps
          needing this — it is NOT a quality score and drives no behaviour.
          Hidden at 1, where it would be noise on every row. */}
      {row.hits > 1 && (
        <span
          title={`Came up ${row.hits} times`}
          style={{
            flexShrink: 0,
            marginTop: 1,
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            color: "var(--fg-neutral-subtle)",
            padding: "1px 6px",
            borderRadius: 999,
            background: "var(--surface-shallow)",
          }}
        >
          {row.hits}×
        </span>
      )}

      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        <IconButton
          size="sm"
          variant="tertiary"
          aria-label={
            row.level === "project"
              ? `Apply everywhere: ${row.fact}`
              : `Limit to this project: ${row.fact}`
          }
          title={row.level === "project" ? "Apply to every project" : "Limit to this project"}
          onClick={() => onPatch(row, { toLevel: row.level === "project" ? "global" : "project" })}
        >
          <Globe />
        </IconButton>
        <IconButton
          size="sm"
          variant="tertiary"
          aria-label={row.pinned ? `Unpin: ${row.fact}` : `Pin: ${row.fact}`}
          title={row.pinned ? "Unpin — let this age out" : "Pin — always keep this"}
          onClick={() => onPatch(row, { pinned: !row.pinned })}
        >
          {row.pinned ? <PinFilled /> : <Pin />}
        </IconButton>
        <IconButton
          size="sm"
          variant="tertiary"
          aria-label={`Forget: ${row.fact}`}
          title="Forget this"
          onClick={() => onDelete(row)}
        >
          <TrashBin />
        </IconButton>
      </div>
    </li>
  );
}

/**
 * What's already in the project. Read-only — it mirrors the frames on disk, so
 * there is nothing here to correct. The component names are the useful part:
 * they say what the agent will reuse instead of rebuilding.
 */
function Inventory({ view }: { view: InventoryView }) {
  if (view.frames.length === 0 && view.composites.length === 0) {
    return <p style={{ margin: 0, fontSize: 13, color: "var(--fg-neutral-subtle)" }}>No frames yet.</p>;
  }
  return (
    <div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {view.frames.map((f) => (
          <li
            key={f.slug}
            style={{
              padding: "8px 0",
              borderTop: "1px solid var(--stroke-neutral-subtle)",
              fontSize: 13,
            }}
          >
            <div style={{ color: "var(--fg-neutral-prominent)" }}>{f.slug}</div>
            {f.components.length > 0 && (
              <div
                title={f.components.join(", ")}
                style={{
                  marginTop: 2,
                  fontSize: 12,
                  color: "var(--fg-neutral-subtle)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.components.slice(0, 4).join(", ")}
                {f.components.length > 4 && ` +${f.components.length - 4} more`}
              </div>
            )}
          </li>
        ))}
      </ul>
      {view.composites.length > 0 && (
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
          Your saved components: {view.composites.join(", ")}
        </p>
      )}
    </div>
  );
}

function RuleEditor({
  text,
  placeholder,
  onSave,
}: {
  text: string;
  placeholder: string;
  onSave: (t: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(text);
  const dirty = draft.trim() !== text.trim();
  return (
    <div>
      <TextArea
        value={draft}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
        aria-label="Standing instructions"
      />
      {dirty && (
        <div style={{ marginTop: 8 }}>
          <Button size="sm" onClick={() => onSave(draft)}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
