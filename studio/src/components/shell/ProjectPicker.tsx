import { useEffect, useRef, useState } from "react";
import type { Project } from "../../../server/types";
import { api } from "../../lib/api";

export function ProjectPicker({
  project,
  onHome,
  onOpenProject,
  onRenamed,
}: {
  project: Project;
  onHome?: () => void;
  onOpenProject?: (slug: string) => void;
  onRenamed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  async function handleRename() {
    const next = prompt("Rename project", project.name);
    setOpen(false);
    if (!next || !next.trim() || next.trim() === project.name) return;
    try {
      await api.renameProject(project.slug, next.trim());
      if (onRenamed) onRenamed();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rename failed");
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api.listProjects().then((list) => {
      if (!cancelled) setProjects(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const recent = (projects ?? [])
    .filter((p) => p.slug !== project.slug)
    .slice(0, 10);

  return (
    <span ref={rootRef} style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
      <button
        type="button"
        onClick={onHome}
        title="Back to projects"
        style={{
          background: "transparent",
          border: "none",
          padding: "2px 6px",
          margin: "0 -6px",
          borderRadius: 4,
          font: "inherit",
          color: "inherit",
          cursor: onHome ? "pointer" : "default",
        }}
        onMouseEnter={(e) => {
          if (onHome) (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-shallow)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        Studio
      </button>
      <span style={{ color: "var(--fg-neutral-subtle)" }}>·</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: open ? "var(--surface-shallow)" : "transparent",
          border: "none",
          padding: "2px 6px",
          borderRadius: 4,
          font: "inherit",
          color: "inherit",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-shallow)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = open
            ? "var(--surface-shallow)"
            : "transparent";
        }}
      >
        <span>{project.name}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          style={{
            opacity: 0.6,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
          aria-hidden="true"
        >
          <path d="M6 8L3 5h6L6 8z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 240,
            maxHeight: 400,
            overflowY: "auto",
            background: "var(--surface-overlay)",
            border: "1px solid var(--stroke-neutral-subtle)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: 4,
            zIndex: 50,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleRename()}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "6px 10px",
              fontSize: 13,
              background: "transparent",
              border: "none",
              borderRadius: 4,
              color: "var(--fg-neutral-prominent)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-shallow)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            Rename project…
          </button>
          <div
            style={{
              height: 1,
              background: "var(--stroke-neutral-subtle)",
              margin: "4px 0",
            }}
          />
          {recent.length === 0 && projects !== null && (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--fg-neutral-subtle)",
              }}
            >
              No other projects
            </div>
          )}
          {projects === null && (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--fg-neutral-subtle)",
              }}
            >
              Loading…
            </div>
          )}
          {recent.map((p) => (
            <button
              key={p.slug}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (onOpenProject) onOpenProject(p.slug);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                fontSize: 13,
                background: "transparent",
                border: "none",
                borderRadius: 4,
                color: "var(--fg-neutral-prominent)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-shallow)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              {p.name}
            </button>
          ))}
          {onHome && (
            <>
              <div
                style={{
                  height: 1,
                  background: "var(--stroke-neutral-subtle)",
                  margin: "4px 0",
                }}
              />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onHome();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  fontSize: 13,
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  color: "var(--fg-neutral-subtle)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-shallow)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                View all projects…
              </button>
            </>
          )}
        </div>
      )}
    </span>
  );
}
