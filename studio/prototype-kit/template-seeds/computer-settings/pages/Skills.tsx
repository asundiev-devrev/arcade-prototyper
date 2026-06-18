import * as React from "react";
import { SkillCard } from "arcade-prototypes";
import { Tabs, Tag, Link, LightingBolt, HumanSilhouette, ChevronRightSmall } from "arcade/components";

const skills = [
  { title: "Prospect Research", description: "Pulls a company brief before any outreach so you walk in knowing more than they expect." },
  { title: "Cold Email Writer", description: "Turns a name and a URL into a sharp, personalised first message worth replying to." },
  { title: "Meeting Recap", description: "Summarises a call into decisions, owners, and next steps the moment it ends." },
];

export default function Skills() {
  return (
    <div className="flex flex-col gap-6">
      <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.Root defaultValue="discover">
          <Tabs.List>
            <Tabs.Trigger value="discover">Discover</Tabs.Trigger>
            <Tabs.Trigger value="mine">My skills</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>
      <div className="flex items-center gap-4 rounded-square-x2 border px-5 py-4"
        style={{ borderColor: "var(--stroke-neutral-subtle)", background: "var(--bg-neutral-soft)" }}>
        <HumanSilhouette size={20} color="var(--fg-neutral-subtle)" />
        <span>Not sure what capabilities are? <Link mode="inline" href="#">Find out more</Link></span>
        <ChevronRightSmall size={16} color="var(--fg-neutral-subtle)" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((s) => (
          <SkillCard
            key={s.title}
            icon={<LightingBolt size={20} color="#2563eb" />}
            title={s.title}
            description={s.description}
            status={<Tag intent="neutral" appearance="tinted">DevRev</Tag>}
          />
        ))}
      </div>
    </div>
  );
}
