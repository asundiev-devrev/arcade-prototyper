import { useEffect, useState } from "react";
import { api, type TemplateSummary } from "../../lib/api";
import { TemplateCard } from "./TemplateCard";

export function TemplatesSection({ onStart }: { onStart: (templateId: string) => void }) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api.listTemplates().then((t) => { if (!cancelled) setTemplates(t); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (templates.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 16,
      }}
    >
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} onPick={onStart} />
      ))}
    </div>
  );
}
