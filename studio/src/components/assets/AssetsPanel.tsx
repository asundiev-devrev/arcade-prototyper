import { useMemo, useState, useRef, type ChangeEvent } from "react";
import { useAssetsCatalog, useUserComponents } from "./useAssetsCatalog";
import type { AssetItem, IconItem } from "./useAssetsCatalog";
import { AssetCard } from "./AssetCard";
import { AssetDetail } from "./AssetDetail";
import { IconGrid } from "./IconGrid";
import { captureComponentThumb } from "./captureComponentThumb";

type CardKind = "composite" | "component";
// `userThumb`, when set, is the /api/components/<name>/thumb URL for a saved
// component (shipped composites resolve their thumb from the asset route).
type Selected = { item: AssetItem; kind: CardKind; userThumb?: string };

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
  const userComps = useUserComponents();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const tsx = await file.text();
      const res = await fetch("/api/components/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tsx }),
      });
      let importedName: string | undefined;
      if (res.status === 409) {
        // Collision - confirm replace
        if (confirm(`A component with this name already exists. Replace it?`)) {
          const retryRes = await fetch("/api/components/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tsx, replace: true }),
          });
          if (!retryRes.ok) {
            const err = await retryRes.json().catch(() => ({}));
            setImportError((err as any).error?.message || "Import failed");
            return;
          }
          importedName = (await retryRes.json().catch(() => ({})))?.name;
        } else {
          return;
        }
      } else if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setImportError((err as any).error?.message || "Import failed");
        return;
      } else {
        importedName = (await res.json().catch(() => ({})))?.name;
      }
      setImportError(null);
      // Capture a thumbnail for the imported component (best-effort).
      if (importedName) await captureComponentThumb(importedName);
      userComps.reload();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      e.target.value = "";
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    try {
      await fetch(`/api/components/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      userComps.reload();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

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
          thumbSrc={selected.userThumb}
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
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            aria-label="Search assets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            style={{
              flex: 1,
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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Import component"
            style={{
              padding: "6px 10px",
              fontSize: 13,
              border: "1px solid var(--stroke-neutral-subtle)",
              borderRadius: 6,
              background: "var(--surface-shallow)",
              color: "var(--fg-neutral-prominent)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Import
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tsx"
          hidden
          onChange={handleImport}
        />
        {importError && (
          <div
            style={{
              fontSize: 12,
              color: "var(--fg-alert-prominent)",
              marginTop: 4,
            }}
          >
            {importError}
          </div>
        )}
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
        {userComps.items.length > 0 && (
          <Section label="Your components" count={userComps.items.length}>
            <div style={gridStyle}>
              {userComps.items.map((comp) => (
                <div key={comp.name} style={{ position: "relative" }}>
                  <AssetCard
                    item={{ name: comp.name, doc: comp.description, thumb: comp.thumb ? "1" : null }}
                    thumbSrc={comp.thumb ? `/api/components/${encodeURIComponent(comp.name)}/thumb` : undefined}
                    onClick={() =>
                      setSelected({
                        item: { name: comp.name, doc: comp.description, thumb: comp.thumb ? "1" : null },
                        kind: "component",
                        userThumb: comp.thumb
                          ? `/api/components/${encodeURIComponent(comp.name)}/thumb`
                          : undefined,
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(comp.name);
                    }}
                    title="Delete"
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      width: 24,
                      height: 24,
                      padding: 0,
                      border: "1px solid var(--stroke-neutral-subtle)",
                      borderRadius: 4,
                      background: "var(--surface-shallow)",
                      color: "var(--fg-neutral-subtle)",
                      cursor: "pointer",
                      fontSize: 16,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {(!q || filteredComposites.length > 0) && (
          <Section label="Components" count={filteredComposites.length}>
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
          <Section label="Elements" count={filteredComponents.length}>
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
