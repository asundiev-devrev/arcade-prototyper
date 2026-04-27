import { useEffect, useState } from "react";

export function FileTree({ slug, onPick }: { slug: string; onPick: (p: string) => void }) {
  const [entries, setEntries] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${slug}/tree`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setEntries(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, refreshKey]);

  useEffect(() => {
    function onFocus() {
      setRefreshKey((k) => k + 1);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return (
    <ul
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        padding: 8,
        margin: 0,
        listStyle: "none",
        overflowY: "auto",
        minHeight: 0,
      }}
    >
      {entries.map((e) => (
        <li
          key={e}
          onClick={() => !e.endsWith("/") && onPick(e)}
          style={{
            padding: "2px 4px",
            cursor: e.endsWith("/") ? "default" : "pointer",
            color: e.endsWith("/")
              ? "var(--fg-neutral-subtle)"
              : "var(--fg-neutral-prominent)",
          }}
        >
          {e}
        </li>
      ))}
    </ul>
  );
}
