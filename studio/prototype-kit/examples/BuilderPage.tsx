import React from "react";
import { BuilderPage } from "../templates/BuilderPage.js";
import { NavSidebar } from "../composites/NavSidebar.js";
import { CapabilitySection } from "../composites/CapabilitySection.js";
import { EntityCard } from "../composites/EntityCard.js";
import {
  Tabs,
  Button,
  Avatar,
  Book,
  Mcp,
  Shield,
  HouseWithHorizontalLine,
  Cog,
} from "../arcade-components";

export default (
  <div className="h-[720px] w-[1100px]">
    <BuilderPage
      sidebar={
        <NavSidebar workspace="Acme Corp">
          <NavSidebar.Section title="Studio">
            <NavSidebar.Item icon={<HouseWithHorizontalLine size={16} />} label="Agents" active />
            <NavSidebar.Item icon={<Cog size={16} />} label="Settings" />
          </NavSidebar.Section>
        </NavSidebar>
      }
      actions={<Avatar name="Ava Wright" size="sm" />}
      tabs={
        <Tabs.Root defaultValue="build">
          <Tabs.List aria-label="Agent builder">
            <Tabs.Trigger value="build">Build</Tabs.Trigger>
            <Tabs.Trigger value="test">Test</Tabs.Trigger>
            <Tabs.Trigger value="deploy">Deploy</Tabs.Trigger>
            <Tabs.Trigger value="observe">Observe</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      }
      toolbar={<Button variant="primary">Publish</Button>}
      title="CX Agent"
      subtitle="You are a customer experience agent that triages inbound tickets and drafts replies."
    >
      <CapabilitySection
        icon={<Book size={20} />}
        title="Knowledge"
        description="Add sources your agent can reference."
        action={<Button variant="tertiary">+ Add</Button>}
      >
        <EntityCard title="Help Center" description="312 articles" />
        <EntityCard title="Product docs" description="48 pages" />
      </CapabilitySection>
      <CapabilitySection
        icon={<Mcp size={20} />}
        title="Skills & tools"
        description="Connect actions the agent can take."
        action={<Button variant="tertiary">+ Add</Button>}
      >
        <EntityCard title="Create ticket" description="DevRev" />
      </CapabilitySection>
      <CapabilitySection
        icon={<Shield size={20} />}
        title="Guardrails"
        description="Set boundaries for agent behavior."
        action={<Button variant="tertiary">+ Add</Button>}
      >
        <EntityCard title="No refunds over $500" description="Escalate to human" />
      </CapabilitySection>
    </BuilderPage>
  </div>
);
