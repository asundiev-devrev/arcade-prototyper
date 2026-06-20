import React from "react";
import { SettingsPage } from "../templates/SettingsPage.js";
import { NavSidebar } from "../composites/NavSidebar.js";
import { SettingsCard } from "../composites/SettingsCard.js";
import { SettingsRow } from "../composites/SettingsRow.js";
import {
  Breadcrumb,
  Switch,
  Button,
  Avatar,
  IconButton,
  Bell,
  MagnifyingGlass,
  Cog,
  HouseWithHorizontalLine,
} from "../arcade-components";

export default (
  <div className="h-[720px] w-[1100px]">
    <SettingsPage
      sidebar={
        <NavSidebar workspace="Acme Corp">
          <NavSidebar.Section title="Personal">
            <NavSidebar.Item icon={<HouseWithHorizontalLine size={16} />} label="My work" />
            <NavSidebar.Item icon={<Cog size={16} />} label="Settings" active />
          </NavSidebar.Section>
        </NavSidebar>
      }
      breadcrumb={
        <Breadcrumb.Root>
          <Breadcrumb.Item>
            <Breadcrumb.Link href="#">Settings</Breadcrumb.Link>
          </Breadcrumb.Item>
          <Breadcrumb.Separator />
          <Breadcrumb.Item current>Notifications</Breadcrumb.Item>
        </Breadcrumb.Root>
      }
      actions={
        <>
          <IconButton aria-label="Search" variant="tertiary">
            <MagnifyingGlass size={16} />
          </IconButton>
          <IconButton aria-label="Notifications" variant="tertiary">
            <Bell size={16} />
          </IconButton>
          <Avatar name="Ava Wright" size="sm" />
        </>
      }
      title="Notifications"
      subtitle="Choose how and when you hear from your workspace."
      titleAction={<Button variant="primary">Save changes</Button>}
    >
      <SettingsCard title="Email">
        <SettingsRow
          label="Weekly digest"
          description="A summary of activity every Monday"
          control={<Switch defaultChecked />}
        />
        <SettingsRow
          label="Mentions"
          description="Email me when someone @-mentions me"
          control={<Switch />}
        />
      </SettingsCard>
    </SettingsPage>
  </div>
);
