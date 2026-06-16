import React from "react";
import { AppShell } from "../composites/AppShell.js";
import { NavSidebar } from "../composites/NavSidebar.js";
import { BreadcrumbBar } from "../composites/BreadcrumbBar.js";
import { PageBody } from "../composites/PageBody.js";
import { Breadcrumb, Button, Cog, Buildings } from "../arcade-components";

export default (
  <AppShell
    sidebar={
      <NavSidebar workspace="Acme Corp">
        <NavSidebar.Section title="Personal">
          <NavSidebar.Item icon={<Buildings size={16} />} label="My work" active />
          <NavSidebar.Item icon={<Cog size={16} />} label="Settings" />
        </NavSidebar.Section>
      </NavSidebar>
    }
    breadcrumbBar={
      <BreadcrumbBar
        breadcrumb={
          <Breadcrumb.Root>
            <Breadcrumb.Item>
              <Breadcrumb.Link href="#">Settings</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item current>
              <Breadcrumb.Link href="#">Members</Breadcrumb.Link>
            </Breadcrumb.Item>
          </Breadcrumb.Root>
        }
        actions={<Button variant="primary">Invite</Button>}
      />
    }
  >
    <PageBody title="Members" subtitle="Manage who has access to this workspace.">
      <div className="text-body text-(--fg-neutral-prominent)">240 active members</div>
    </PageBody>
  </AppShell>
);
