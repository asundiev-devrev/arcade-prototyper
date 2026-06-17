import { useMemo, useState } from "react";
import { useAssetsCatalog } from "./useAssetsCatalog";
import type { AssetItem, IconItem } from "./useAssetsCatalog";
import { AssetCard } from "./AssetCard";
import { AssetDetail } from "./AssetDetail";
import { IconGrid } from "./IconGrid";

type CardKind = "composite" | "component";
type Selected = { item: AssetItem; kind: CardKind };

function matchesAsset(item: AssetItem, q: string): boolean {
  if (!q) return true;
  return (
    item.name.toLowerCase().includes(q) ||
    (item.doc || "").toLowerCase().includes(q)
  );
}

function matchesIcon(icon: IconItem, q: string): boolean {
  if (!q) return true;
  return (
    icon.name.toLowerCase().includes(q) ||
    icon.tags.some((t) => t.toLowerCase().includes(q))
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--fg-neutral-subtle)",
        }}
      >
        {label} · {count}
      </div>
      {children}
    </section>
  );
}

/**
 * Left-pane Assets tab. Lists the composites, components, and icons the
 * generator knows about, with a live search box. Picking a composite or
 * component opens a detail view whose "Use this" button seeds a kind-aware
 * prompt into the chat (onSeed) and asks the shell to switch back to the
 * Chat tab (onSeeded). Icons copy their name to the clipboard on click.
 */
export function AssetsPanel({
  onSeed,
  onSeeded,
}: {
  onSeed: (text: string) => void;
  onSeeded: () => void;
}) {
  const state = useAssetsCatalog();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);

  const catalog = state.status === "ready" ? state.catalog : null;

  const composites = useMemo(
    () =>
      (catalog?.sections.find((s) => s.kind === "composite")?.items as AssetItem[] | undefined) ?? [],
    [catalog],
  );
  const components = useMemo(
    () =>
      (catalog?.sections.find((s) => s.kind === "component")?.items as AssetItem[] | undefined) ?? [],
    [catalog],
  );
  const icons = useMemo(
    () =>
      (catalog?.sections.find((s) => s.kind === "icon")?.items as IconItem[] | undefined) ?? [],
    [catalog],
  );

  const q = query.trim().toLowerCase();
  const filteredComposites = composites.filter((i) => matchesAsset(i, q));
  const filteredComponents = components.filter((i) => matchesAsset(i, q));
  const filteredIcons = icons.filter((i) => matchesIcon(i, q));

  const container: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    background: "var(--surface-overlay)",
    color: "var(--fg-neutral-prominent)",
  };

  if (state.status === "loading") {
    return (
      <div style={{ ...container, alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 13, color: "var(--fg-neutral-subtle)" }}>Loading assets…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div style={{ ...container, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <span style={{ fontSize: 13, color: "var(--fg-neutral-subtle)", textAlign: "center" }}>
          Assets unavailable — run the build.
        </span>
      </div>
    );
  }

  if (selected) {
    return (
      <div style={container}>
        <AssetDetail
          item={selected.item}
          kind={selected.kind}
          onBack={() => setSelected(null)}
          onUse={() => {
            onSeed(`Use the ${selected.item.name} ${selected.kind} to `);
            onSeeded();
          }}
        />
      </div>
    );
  }

  const gridStyle: React.CSSProperties = {
    display: "grid",
    // Fixed 2 columns: thumbnails scale up as the panel widens, so the
    // user can enlarge the pane to read previews instead of getting more,
    // smaller tiles.
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 8,
  };

  return (
    <div style={container}>
      <div style={{ padding: 12, borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <input
          type="text"
          aria-label="Search assets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search assets…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "6px 10px",
            fontSize: 13,
            border: "1px solid var(--stroke-neutral-subtle)",
            borderRadius: 6,
            background: "var(--surface-shallow)",
            color: "var(--fg-neutral-prominent)",
            outline: "none",
          }}
        />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {(!q || filteredComposites.length > 0) && (
          <Section label="Composites" count={filteredComposites.length}>
            <div style={gridStyle}>
              {filteredComposites.map((item) => (
                <AssetCard
                  key={item.name}
                  item={item}
                  onClick={() => setSelected({ item, kind: "composite" })}
                />
              ))}
            </div>
          </Section>
        )}

        {(!q || filteredComponents.length > 0) && (
          <Section label="Components" count={filteredComponents.length}>
            <div style={gridStyle}>
              {filteredComponents.map((item) => (
                <AssetCard
                  key={item.name}
                  item={item}
                  onClick={() => setSelected({ item, kind: "component" })}
                />
              ))}
            </div>
          </Section>
        )}

        {(!q || filteredIcons.length > 0) && (
          <Section label="Icons" count={filteredIcons.length}>
            <IconGrid icons={filteredIcons} />
          </Section>
        )}
      </div>
    </div>
  );
}
