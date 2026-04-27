import { useState } from "react";
import { FileTree } from "./FileTree";

export function DevModePanel({ slug }: { slug: string }) {
  const [picked, setPicked] = useState<{ path: string; content: string } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  async function pick(p: string) {
    try {
      const r = await fetch(`/api/projects/${slug}/file?path=${encodeURIComponent(p)}`);
      if (!r.ok) throw new Error(`load failed: ${r.status}`);
      const data = await r.json();
      setPicked({ path: p, content: data.content });
    } catch (err) {
      console.error("Failed to load file:", err);
    }
  }

  async function reveal() {
    try {
      await fetch(`/api/projects/${slug}/reveal`, { method: "POST" });
    } catch (err) {
      console.error("Failed to reveal:", err);
    }
  }

  return (
    <aside
      style={{
        width: isExpanded ? 480 : 320,
        transition: "width 0.2s ease",
        borderLeft: "1px solid var(--stroke-neutral-subtle)",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-overlay)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 44,
          padding: "0 12px",
          borderBottom: "1px solid var(--stroke-neutral-subtle)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 540,
            color: "var(--fg-neutral-prominent)",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="2"
              y="2"
              width="12"
              height="12"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M5.5 6L7.5 8L5.5 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9 10H11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          Canvas
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            border: 0,
            background: "transparent",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--fg-neutral-subtle)",
            borderRadius: 4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--control-bg-neutral-subtle-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
          title={isExpanded ? "Compact" : "Expand"}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {isExpanded ? (
              <path
                d="M10 6L8 8L10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <path
                d="M6 6L8 8L6 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </button>
      </div>

      {/* File tree */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <FileTree slug={slug} onPick={pick} />
      </div>

      {/* File preview */}
      {picked ? (
        <div
          style={{
            borderTop: "1px solid var(--stroke-neutral-subtle)",
            overflow: "auto",
            maxHeight: "40%",
            minHeight: 120,
          }}
        >
          <div
            style={{
              padding: "6px 12px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--fg-neutral-subtle)",
              borderBottom: "1px solid var(--stroke-neutral-subtle)",
              background: "var(--surface-shallow)",
            }}
          >
            {picked.path}
          </div>
          <pre
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              padding: 12,
              margin: 0,
              background: "var(--surface-backdrop)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--fg-neutral-prominent)",
            }}
          >
            {picked.content}
          </pre>
        </div>
      ) : null}

      {/* Footer */}
      <button
        onClick={reveal}
        style={{
          border: 0,
          borderTop: "1px solid var(--stroke-neutral-subtle)",
          padding: "10px 12px",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--fg-neutral-prominent)",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--control-bg-neutral-subtle-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M2 5c0-.83.67-1.5 1.5-1.5h2.59c.4 0 .78.16 1.06.44L8.2 5H12.5c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5V5Z"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinejoin="round"
          />
        </svg>
        Reveal in Finder
      </button>
    </aside>
  );
}
