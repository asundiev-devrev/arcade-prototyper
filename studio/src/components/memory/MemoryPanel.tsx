import { useState } from "react";
import { Button, IconButton, TextArea } from "@xorkavi/arcade-gen";
import { useMemory, type LearnedRowView } from "./useMemory";

/**
 * The Memory panel: what the agent currently knows, and where to fix it when
 * output looks wrong. Deliberately a DIAGNOSTIC surface, not a dashboard —
 * memory accrues silently, and nothing here demands attention. Expect it to go
 * unopened for long stretches.
 */
export function MemoryPanel({ projectSlug }: { projectSlug: string }) {
  const { status, data, patchRow, deleteRow, saveRule } = useMemory(projectSlug);

  if (status === "loading") {
    return <div className="p-4 text-(--fg-neutral-soft)">Loading…</div>;
  }
  if (status === "error" || !data) {
    return (
      <div className="p-4 text-(--fg-neutral-soft)">
        Couldn't load what Studio remembers.
      </div>
    );
  }

  const empty =
    data.global.rows.length === 0 &&
    data.project.rows.length === 0 &&
    !data.global.rules &&
    !data.project.rules;

  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-4">
      {empty && (
        <p className="text-(--fg-neutral-soft)">
          Studio hasn't learned anything yet. Ask for a few frames, or write a
          rule below.
        </p>
      )}

      <Section title="Always — your rules" level="Global">
        <RuleEditor
          text={data.global.rules}
          onSave={(t) => saveRule("global", t)}
        />
      </Section>

      {data.global.rows.length > 0 && (
        <Section title="Learned" level="Global">
          {data.global.rows.map((r) => (
            <Row key={r.id} row={r} onPatch={patchRow} onDelete={deleteRow} />
          ))}
        </Section>
      )}

      <hr className="border-(--border-neutral-soft)" />

      <Section title="This project — rules">
        <RuleEditor
          text={data.project.rules}
          onSave={(t) => saveRule("project", t)}
        />
      </Section>

      {data.project.rows.length > 0 && (
        <Section title="Learned here only">
          {data.project.rows.map((r) => (
            <Row key={r.id} row={r} onPatch={patchRow} onDelete={deleteRow} />
          ))}
        </Section>
      )}

      {data.inventory && (
        <Section title="Built here">
          <pre className="whitespace-pre-wrap text-sm text-(--fg-neutral-soft)">
            {data.inventory}
          </pre>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  level,
  children,
}: {
  title: string;
  level?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide">{title}</h3>
        {level && <span className="text-xs text-(--fg-neutral-soft)">{level}</span>}
      </header>
      {children}
    </section>
  );
}

function Row({
  row,
  onPatch,
  onDelete,
}: {
  row: LearnedRowView;
  onPatch: (r: LearnedRowView, p: { fact?: string; pinned?: boolean; toLevel?: "global" | "project" }) => Promise<void>;
  onDelete: (r: LearnedRowView) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.fact);

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <TextArea
          value={draft}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
          aria-label={`Edit: ${row.fact}`}
        />
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              await onPatch(row, { fact: draft });
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button onClick={() => { setDraft(row.fact); setEditing(false); }}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start justify-between gap-2">
      <button
        className="text-left"
        onClick={() => setEditing(true)}
        aria-label={`Edit: ${row.fact}`}
      >
        {row.fact}
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {/* Hit count: the fastest way to spot a fact the agent keeps needing.
            NOT a value score — it drives neither eviction nor success. */}
        <span className="text-xs text-(--fg-neutral-soft)">×{row.hits}</span>
        <IconButton
          aria-label={
            row.level === "project"
              ? `Apply everywhere: ${row.fact}`
              : `Limit to this project: ${row.fact}`
          }
          onClick={() =>
            onPatch(row, { toLevel: row.level === "project" ? "global" : "project" })
          }
        />
        <IconButton
          aria-label={row.pinned ? `Unpin: ${row.fact}` : `Pin: ${row.fact}`}
          onClick={() => onPatch(row, { pinned: !row.pinned })}
        />
        <IconButton aria-label={`Forget: ${row.fact}`} onClick={() => onDelete(row)} />
      </div>
    </div>
  );
}

function RuleEditor({ text, onSave }: { text: string; onSave: (t: string) => Promise<void> }) {
  const [draft, setDraft] = useState(text);
  const dirty = draft.trim() !== text.trim();
  return (
    <div className="flex flex-col gap-2">
      <TextArea
        value={draft}
        placeholder="e.g. Never use emoji in UI copy"
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
        aria-label="Standing instructions"
      />
      {dirty && <Button onClick={() => onSave(draft)}>Save</Button>}
    </div>
  );
}
