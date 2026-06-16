import { useState } from "react";
import { Button } from "@xorkavi/arcade-gen";
import type { AssetItem } from "./useAssetsCatalog";

/**
 * The detail view for a single composite or component: a back button, a
 * larger preview, the name + one-line doc, and a "Use this" button that
 * seeds a kind-aware prompt into the chat. No props/types are shown —
 * designers don't need them.
 */
export function AssetDetail({
  item,
  kind,
  onBack,
  onUse,
}: {
  item: AssetItem;
  kind: "composite" | "component";
  onBack: () => void;
  onUse: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const showImage = !!item.thumb && !imgError;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          border: 0,
          background: "transparent",
          cursor: "pointer",
          padding: "4px 0",
          color: "var(--fg-neutral-subtle)",
          fontSize: 13,
          alignSelf: "flex-start",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M10 4L6 8L10 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back
      </button>

      <div
        style={{
          aspectRatio: "4 / 3",
          width: "100%",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--stroke-neutral-subtle)",
          background: "var(--surface-backdrop)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {showImage ? (
          <img
            src={`/api/assets/thumbs/${encodeURIComponent(item.name)}.png`}
            alt={item.name}
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ fontSize: 13, color: "var(--fg-neutral-subtle)" }}>{item.name}</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--fg-neutral-subtle)",
          }}
        >
          {kind === "composite" ? "Composite" : "Component"}
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-neutral-prominent)" }}>
          {item.name}
        </span>
        {item.doc ? (
          <span style={{ fontSize: 13, color: "var(--fg-neutral-subtle)" }}>{item.doc}</span>
        ) : null}
      </div>

      <div style={{ alignSelf: "flex-start" }}>
        <Button onClick={onUse}>Use this</Button>
      </div>
    </div>
  );
}
