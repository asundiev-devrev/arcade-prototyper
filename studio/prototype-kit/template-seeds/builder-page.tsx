import * as React from "react";
import { BuilderPage, CapabilitySection, NavSidebar } from "arcade-prototypes";
import { Breadcrumb, Button, IconButton, Avatar, Tabs, Tag } from "arcade/components";
import { Book, LightingBolt, Shield, PlusSmall, Bell, MagnifyingGlass } from "arcade/components";

const sidebarSections: Array<{ title?: string; items: Array<{ label: string; active?: boolean }> }> = [
  { title: "Agent Studio", items: [{ label: "Agents", active: true }, { label: "Templates" }, { label: "Knowledge" }, { label: "Tools" }] },
  { title: "Workspace", items: [{ label: "Activity" }, { label: "Settings" }] },
];

const knowledge = ["Product documentation", "Help center articles"];
const tools = ["Search tickets", "Create ticket"];

export default function AgentBuilderTemplate() {
  return (
    <BuilderPage
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
      actions={
        <div className="flex items-center gap-1">
          <IconButton variant="tertiary" size="sm" aria-label="Search"><MagnifyingGlass size={16} /></IconButton>
          <IconButton variant="tertiary" size="sm" aria-label="Notifications"><Bell size={16} /></IconButton>
          <Avatar name="Ben Carter" size="sm" />
        </div>
      }
      breadcrumb={
        <Breadcrumb.Root>
          <Breadcrumb.Item><Breadcrumb.Link href="#">Agents</Breadcrumb.Link></Breadcrumb.Item>
          <Breadcrumb.Separator />
          <Breadcrumb.Item><Breadcrumb.Link href="#" current>CX Agent</Breadcrumb.Link></Breadcrumb.Item>
        </Breadcrumb.Root>
      }
      headerActions={<Tag intent="success" appearance="tinted">Published</Tag>}
      tabs={
        <Tabs.Root defaultValue="build">
          <Tabs.List>
            <Tabs.Trigger value="build">Build</Tabs.Trigger>
            <Tabs.Trigger value="test">Test</Tabs.Trigger>
            <Tabs.Trigger value="deploy">Deploy</Tabs.Trigger>
            <Tabs.Trigger value="observe">Observe</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      }
      toolbar={<Button variant="primary" size="sm">Publish</Button>}
      title="CX Agent"
      subtitle="You are a customer experience agent. Help customers resolve issues quickly, escalate when needed, and keep a warm, concise tone."
    >
      <div className="text-title-3 text-(--fg-neutral-prominent)">Capabilities</div>

      <CapabilitySection
        icon={<Book size={20} />}
        title="Knowledge"
        description="Add sources your agent can reference."
        action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Add</Button>}
      >
        {knowledge.map((k) => (
          <div
            key={k}
            className="flex items-center rounded-square-x2 border px-4 py-3 text-body-medium"
            style={{ borderColor: "var(--stroke-neutral-subtle)", color: "var(--fg-neutral-prominent)" }}
          >
            {k}
          </div>
        ))}
      </CapabilitySection>

      <CapabilitySection
        icon={<LightingBolt size={20} />}
        title="Skills, Tools & Workflows"
        description="Let the agent take actions on your behalf."
        action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Add</Button>}
      >
        {tools.map((t) => (
          <div
            key={t}
            className="flex items-center rounded-square-x2 border px-4 py-3 text-body-medium"
            style={{ borderColor: "var(--stroke-neutral-subtle)", color: "var(--fg-neutral-prominent)" }}
          >
            {t}
          </div>
        ))}
      </CapabilitySection>

      <CapabilitySection
        icon={<Shield size={20} />}
        title="Guardrails"
        description="Set boundaries for what the agent can and can't do."
        action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Add</Button>}
      />

      <div className="flex flex-col gap-2">
        <div className="text-title-3 text-(--fg-neutral-prominent)">Instructions</div>
        <div
          className="rounded-square-x2 border px-4 py-3 text-body-medium"
          style={{ borderColor: "var(--stroke-neutral-subtle)", color: "var(--fg-neutral-subtle)", minHeight: 120 }}
        >
          Always greet the customer by name. Confirm the issue before proposing a fix. If the
          request involves billing or account deletion, escalate to a human agent.
        </div>
      </div>
    </BuilderPage>
  );
}
