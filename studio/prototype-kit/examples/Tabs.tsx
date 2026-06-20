import React from "react";
import { Tabs } from "../arcade-components";

export default (
  <div className="w-[420px]">
    <Tabs.Root defaultValue="overview">
      <Tabs.List aria-label="Project tabs">
        <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
        <Tabs.Trigger value="activity">Activity</Tabs.Trigger>
        <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="overview">
        <p className="py-3 text-body text-(--fg-neutral-prominent)">
          Project summary and key metrics at a glance.
        </p>
      </Tabs.Content>
      <Tabs.Content value="activity">
        <p className="py-3 text-body text-(--fg-neutral-prominent)">
          Recent activity feed.
        </p>
      </Tabs.Content>
      <Tabs.Content value="settings">
        <p className="py-3 text-body text-(--fg-neutral-prominent)">
          Configuration options.
        </p>
      </Tabs.Content>
    </Tabs.Root>
  </div>
);
