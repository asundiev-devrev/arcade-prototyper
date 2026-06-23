import { useState } from "react";
import type { AssetItem } from "./useAssetsCatalog";

/**
 * A thumbnail tile for a composite or component. The thumbnail image is
 * served by /api/assets/thumbs/<name>.png when the catalog item carries a
 * `thumb`; otherwise we render a name-only placeholder tile so the grid
 * stays even. Clicking the card opens the detail view (handled by the
 * parent via onClick).
 */
export function AssetCard({
  item,
  onClick,
  thumbSrc,
}: {
  item: AssetItem;
  onClick: () => void;
  /** Explicit thumbnail URL. Defaults to the shipped-asset thumb route; user
   *  components pass their own /api/components/<name>/thumb URL. */
  thumbSrc?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const src = thumbSrc ?? `/api/assets/thumbs/${encodeURIComponent(item.name)}.png`;
  // A shipped item signals thumb presence via item.thumb; a user item passes
  // thumbSrc directly. Either way, only attempt the image when we have a source.
  const showImage = (!!item.thumb || !!thumbSrc) && !imgError;

  return (
    <button
      type="button"
      onClick={onClick}
      title={item.doc || item.name}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 8,
        background: "var(--surface-shallow)",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--control-bg-neutral-subtle-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface-shallow)";
      }}
    >
      <div
        style={{
          aspectRatio: "4 / 3",
          width: "100%",
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--surface-backdrop)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {showImage ? (
          <img
            src={src}
            alt={item.name}
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span
            style={{
              fontSize: 12,
              color: "var(--fg-neutral-subtle)",
              padding: 8,
              textAlign: "center",
            }}
          >
            {item.name}
          </span>
        )}
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 540,
          color: "var(--fg-neutral-prominent)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.name}
      </span>
    </button>
  );
}
