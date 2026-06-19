import * as React from "react";
import { Tabs, Button, Avatar, LightingBolt, PlusSmall, ChevronDownSmall } from "arcade/components";

type Skill = { title: string; description: string; author: string; added?: boolean };

const skills: Skill[] = [
  { title: "dashboard-manager", description: "Activate when the user wants to manage DevRev dashboards and widgets.", author: "taiel-kadar", added: true },
  { title: "goal-setting-skill", description: "Test 2", author: "Alex Tamboli" },
  { title: "Access Debugger", description: "Debug and inspect access control, permissions, and roles.", author: "ayush-thakur" },
  { title: "Goal Setting Skill", description: "Activate when an employee wants to set, view, update, or track a goal.", author: "Alex Tamboli", added: true },
  { title: "Enhancement Context", description: "Provides smart, contextual information about a DevRev enhancement.", author: "Priyanka Pal" },
  { title: "Teams and Spaces", description: "This skill helps you answer questions about teams and spaces.", author: "Dhruv Baldwa", added: true },
  { title: "issue-implement", description: "Use this skill whenever doing a code change or review. This keeps work consistent.", author: "Aviral Jain", added: true },
  { title: "Competitive Intelligence", description: "Run competitive intelligence for product marketing and sales.", author: "Rajat Radhakrishnan" },
  { title: "win-pattern-matching", description: "Activate when a user wants to find similar won deals or patterns.", author: "Shreya Gupta" },
];

function SkillCard({ skill }: { skill: Skill }) {
  return (
    <div
      className="flex flex-col gap-4 rounded-square-x2 border p-5"
      style={{ borderColor: "var(--stroke-neutral-subtle)" }}
    >
      <div className="flex items-start justify-between">
        <LightingBolt size={20} color="#2563eb" />
        {skill.added && (
          <span className="rounded-square px-2 py-0.5 text-body-small" style={{ background: "var(--bg-neutral-soft)", color: "var(--fg-neutral-subtle)" }}>
            Added
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{skill.title}</div>
        <div className="line-clamp-2 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{skill.description}</div>
      </div>
      <div className="flex items-center gap-2">
        <Avatar name={skill.author} size="sm" />
        <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{skill.author}</span>
      </div>
    </div>
  );
}

export default function Skills() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-end">
        <Button variant="primary" size="sm" iconLeft={<PlusSmall size={16} />}>Add skills</Button>
      </div>
      <div className="flex items-center justify-between" style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.Root defaultValue="discover">
          <Tabs.List>
            <Tabs.Trigger value="discover">Discover</Tabs.Trigger>
            <Tabs.Trigger value="mine">My Skills</Tabs.Trigger>
            <Tabs.Trigger value="org">Org skills</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
        <button
          type="button"
          className="mb-2 flex items-center gap-1.5 rounded-square border px-2.5 py-1 text-body-small"
          style={{ borderColor: "var(--stroke-neutral-subtle)", color: "var(--fg-neutral-prominent)" }}
        >
          All skills <ChevronDownSmall size={14} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((s) => (<SkillCard key={s.title} skill={s} />))}
      </div>
    </div>
  );
}
