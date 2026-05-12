import * as React from "react";
import { AppShell, TitleBar, BreadcrumbBar, PageBody } from "arcade-prototypes";
import { Tabs, Button, Avatar, Tag, IconButton } from "arcade/components";
import { ChevronRightSmall, PlusSmall } from "arcade/components";

export default function TicketDetail() {
  return (
    <AppShell sidebar={<div />}>
      <TitleBar title="TKT-42">
        <Avatar name="Alice" size="sm" />
        <IconButton variant="tertiary" size="sm" aria-label="Add watcher">
          <PlusSmall size={16} />
        </IconButton>
      </TitleBar>
      <BreadcrumbBar />
      <PageBody>
        <Tabs value="overview" onChange={() => {}}>
          <span>Overview</span>
          <span>Activity</span>
        </Tabs>
        <div className="flex items-center gap-2">
          <Tag intent="neutral">In progress</Tag>
          <ChevronRightSmall size={16} />
          <Button variant="primary">Resolve</Button>
        </div>
      </PageBody>
    </AppShell>
  );
}
