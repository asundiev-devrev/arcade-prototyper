import * as React from "react";
import { SkillCard } from "arcade-prototypes";
import { Tag, ThreeBarsHorizontal } from "arcade/components";

const tools = [
  { title: "Web Search", description: "Look up current information across the web." },
  { title: "Code Runner", description: "Execute snippets and return results inline." },
  { title: "Ticket Triage", description: "Auto-route and label incoming tickets." },
  { title: "Calendar", description: "Read availability and schedule meetings." },
];

export default function WorkflowsTools() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((t) => (
        <SkillCard key={t.title} icon={<ThreeBarsHorizontal size={20} color="#2563eb" />} title={t.title} description={t.description} status={<Tag intent="neutral" appearance="tinted">Tool</Tag>} />
      ))}
    </div>
  );
}
