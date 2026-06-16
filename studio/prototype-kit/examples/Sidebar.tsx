import React from "react";
import { Sidebar } from "../arcade-components";

export default (
  <div className="h-[320px] w-[240px]">
    <Sidebar.Root>
      <Sidebar.Section title="Navigation">
        <Sidebar.Item active>Dashboard</Sidebar.Item>
        <Sidebar.Item>Projects</Sidebar.Item>
        <Sidebar.Item>Tasks</Sidebar.Item>
        <Sidebar.Item>Calendar</Sidebar.Item>
      </Sidebar.Section>
      <Sidebar.Section title="Settings" collapsible>
        <Sidebar.Item>Profile</Sidebar.Item>
        <Sidebar.Item>Notifications</Sidebar.Item>
      </Sidebar.Section>
    </Sidebar.Root>
  </div>
);
