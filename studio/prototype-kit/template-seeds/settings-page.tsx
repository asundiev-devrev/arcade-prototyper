import * as React from "react";
import { SettingsPage, NavSidebar } from "arcade-prototypes";
import { Breadcrumb, Button, IconButton, Avatar, Tabs, Tag, Link } from "arcade/components";
import { MagnifyingGlass, Bell, PlusSmall, TrashBin, LightingBolt, ChevronRightSmall, HumanSilhouette } from "arcade/components";

const sidebarSections: Array<{ title?: string; items: Array<{ label: string; active?: boolean }> }> = [
  { title: "Settings", items: [{ label: "General information" }, { label: "Account" }, { label: "Notifications" }, { label: "Teams" }] },
  { title: "User Management", items: [{ label: "Groups" }, { label: "Roles" }, { label: "Users" }, { label: "Invitations" }, { label: "Skills", active: true }, { label: "Customer management" }] },
];

const skills: Array<{ title: string; description: string }> = [
  { title: "Prospect Research", description: "Pulls a company brief before any outreach so you walk in knowing more than they expect." },
  { title: "Cold Email Writer", description: "Turns a name and a URL into a sharp, personalised first message worth replying to." },
  { title: "Meeting Recap", description: "Summarises a call into decisions, owners, and next steps the moment it ends." },
];

function SkillCard({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-square-x2 border p-5 text-left"
      style={{ borderColor: "var(--stroke-neutral-subtle)", background: "var(--surface-overlay)" }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-square" style={{ background: "var(--bg-neutral-soft)" }}>
        <LightingBolt size={20} color="#2563eb" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{title}</div>
        <div className="text-body-small line-clamp-3" style={{ color: "var(--fg-neutral-subtle)" }}>{description}</div>
      </div>
      <div className="mt-2">
        <Tag intent="neutral" appearance="tinted">DevRev</Tag>
      </div>
    </div>
  );
}

export default function SettingsTemplate() {
  return (
    <SettingsPage
      sidebar={
        <NavSidebar>
          {sidebarSections.map((section) => (
            <NavSidebar.Section key={section.title} title={section.title}>
              {section.items.map((item) => (
                <NavSidebar.Item key={item.label} active={item.active}>{item.label}</NavSidebar.Item>
              ))}
            </NavSidebar.Section>
          ))}
        </NavSidebar>
      }
      breadcrumb={
        <Breadcrumb.Root>
          <Breadcrumb.Item><Breadcrumb.Link href="#">Settings</Breadcrumb.Link></Breadcrumb.Item>
          <Breadcrumb.Separator />
          <Breadcrumb.Item><Breadcrumb.Link href="#" current>Skills</Breadcrumb.Link></Breadcrumb.Item>
        </Breadcrumb.Root>
      }
      actions={
        <div className="flex items-center gap-1">
          <IconButton variant="tertiary" size="sm" aria-label="Search"><MagnifyingGlass size={16} /></IconButton>
          <IconButton variant="tertiary" size="sm" aria-label="Notifications"><Bell size={16} /></IconButton>
          <Avatar name="Ben Carter" size="sm" />
        </div>
      }
      pageActions={
        <div className="flex items-center gap-2">
          <Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Create new</Button>
          <IconButton variant="tertiary" size="sm" aria-label="Delete"><TrashBin size={16} /></IconButton>
          <Button variant="primary" size="sm">Add skill</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 py-2">
        <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
          <Tabs.Root defaultValue="discover">
            <Tabs.List>
              <Tabs.Trigger value="discover">Discover</Tabs.Trigger>
              <Tabs.Trigger value="mine">My skills</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </div>
        <div
          className="flex items-center gap-4 rounded-square-x2 border px-5 py-4 text-left"
          style={{ borderColor: "var(--stroke-neutral-subtle)", background: "var(--bg-neutral-soft)" }}
        >
          <HumanSilhouette size={20} color="var(--fg-neutral-subtle)" />
          <span>Not sure what capabilities are? <Link mode="inline" href="#">Find out more</Link></span>
          <ChevronRightSmall size={16} color="var(--fg-neutral-subtle)" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((s) => (<SkillCard key={s.title} {...s} />))}
        </div>
      </div>
    </SettingsPage>
  );
}
