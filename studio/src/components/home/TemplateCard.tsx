import type { TemplateSummary } from "../../lib/api";

export function TemplateCard({
  template,
  onPick,
}: {
  template: TemplateSummary;
  onPick: (id: string) => void;
}) {
  return (
    <article
      onClick={() => onPick(template.id)}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--surface-shallow)",
        border: "1px solid var(--control-stroke-neutral-medium-active)",
        cursor: "pointer",
      }}
    >
      <div style={{ aspectRatio: "16 / 9", background: "var(--bg-neutral-soft)", overflow: "hidden" }}>
        {/* On a missing/unbuilt thumbnail the <img> 404s; hide it so the
            neutral panel background shows through instead of a broken-image icon. */}
        <img
          src={`/api/templates/${template.id}/thumb`}
          alt=""
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left", display: "block" }}
        />
      </div>
      <div style={{ padding: 16 }}>
        <div
          style={{
            fontFamily: "var(--core-font-display), 'Chip Display Variable', sans-serif",
            fontWeight: 700,
            lineHeight: "16px",
            color: "var(--fg-neutral-prominent)",
          }}
        >
          {template.name}
        </div>
        <div style={{ color: "var(--fg-neutral-subtle)", fontSize: 12, marginTop: 4 }}>
          {template.description}
        </div>
      </div>
    </article>
  );
}
