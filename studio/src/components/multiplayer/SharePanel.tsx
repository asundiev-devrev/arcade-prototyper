import { useEffect, useState } from "react";

interface Collab {
  devu: string;
  displayName: string;
  addedAt: string;
}

interface ShareResponse {
  projectShareId?: string;
  shared_with?: Collab[];
}

/**
 * Host-side panel listing the teammates a project is currently shared with.
 * Talks to the `/api/projects/:slug/collaborators` endpoints introduced in Task 7.
 *
 * v1 takes a raw `devu_…` string in the input box; @-mention popover wiring
 * is a follow-up polish pass.
 */
export function SharePanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch(`/api/projects/${slug}/collaborators`);
      if (!res.ok) return;
      const data = (await res.json()) as ShareResponse;
      setCollabs(data.shared_with ?? []);
    } catch {
      // swallow — panel stays usable even if first load fails
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const remove = async (devu: string) => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/projects/${slug}/collaborators/${encodeURIComponent(devu)}`, {
        method: "DELETE",
      });
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove teammate");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const trimmed = adding.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${slug}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devu: trimmed, displayName: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Share failed (${res.status})`);
      }
      setAdding("");
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not share project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        right: 16,
        zIndex: 10,
        width: 320,
        padding: 16,
        borderRadius: 12,
        background: "var(--surface-overlay)",
        border: "1px solid var(--stroke-neutral-subtle)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
        color: "var(--fg-neutral-prominent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Shared with</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            border: "none",
            background: "transparent",
            color: "var(--fg-neutral-subtle)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {collabs.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
          Not shared yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {collabs.map((c) => (
            <li
              key={c.devu}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 0",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  marginRight: 8,
                }}
                title={c.devu}
              >
                {c.displayName}
              </span>
              <button
                type="button"
                onClick={() => void remove(c.devu)}
                disabled={busy}
                style={{
                  border: "1px solid var(--stroke-neutral-subtle)",
                  background: "transparent",
                  color: "var(--fg-neutral-prominent)",
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: 12,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="devu_… of teammate"
          disabled={busy}
          style={{
            flex: 1,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid var(--stroke-neutral-subtle)",
            background: "var(--surface-shallow)",
            color: "var(--fg-neutral-prominent)",
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || !adding.trim()}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--stroke-neutral-subtle)",
            background: "var(--surface-shallow)",
            color: "var(--fg-neutral-prominent)",
            fontSize: 12,
            cursor: busy || !adding.trim() ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "…" : "Add"}
        </button>
      </div>

      {error ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--fg-critical-prominent)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
