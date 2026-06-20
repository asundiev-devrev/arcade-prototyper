import { useState } from "react";
import type { IconItem } from "./useAssetsCatalog";

/**
 * A dense grid of icons. Each tile renders the inline SVG (from the
 * catalog's `svg` string) in a fixed 24x24 box plus the icon name below.
 * Clicking a tile copies the icon name to the clipboard and flashes
 * "Copied!" on that tile for ~1.2s. No detail view, no seeding.
 */
export function IconGrid({ icons }: { icons: IconItem[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(name: string) {
    try {
      await navigator.clipboard.writeText(name);
    } catch {
      // clipboard may be unavailable; still flash so the click feels live
    }
    setCopied(name);
    window.setTimeout(() => {
      setCopied((c) => (c === name ? null : c));
    }, 1200);
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
        gap: 8,
      }}
    >
      {icons.map((icon) => {
        const isCopied = copied === icon.name;
        return (
          <button
            key={icon.name}
            type="button"
            onClick={() => copy(icon.name)}
            title={icon.name}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: 6,
              border: "1px solid var(--stroke-neutral-subtle)",
              borderRadius: 6,
              background: "var(--surface-shallow)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--control-bg-neutral-subtle-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--surface-shallow)";
            }}
          >
            <span
              aria-hidden
              style={{
                width: 24,
                height: 24,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--fg-neutral-prominent)",
              }}
              dangerouslySetInnerHTML={{ __html: icon.svg }}
            />
            <span
              style={{
                fontSize: 10,
                color: isCopied ? "var(--fg-accent-prominent)" : "var(--fg-neutral-subtle)",
                width: "100%",
                textAlign: "center",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {isCopied ? "Copied!" : icon.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
