import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Tabs, Switch, Button, PlusSmall } from "arcade/components";

export default function MyComputer() {
  return (
    <div className="flex flex-col gap-6">
      <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.Root defaultValue="general">
          <Tabs.List>
            <Tabs.Trigger value="general">General</Tabs.Trigger>
            <Tabs.Trigger value="desktop">Desktop app</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>
      <SettingsCard title="General settings">
        <SettingsRow label="Run on start up" description="Automatically start Computer on start up" control={<Switch defaultChecked />} />
        <SettingsRow label="File Directory" description="Where Computer saves your files and skills."
          action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>/Users/Shashank.Sin…</Button>} />
        <SettingsRow label="Quick access short cut" description="Bring Computer to your attention quickly"
          action={<span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Manage</span>} control={<Switch defaultChecked />} />
        <SettingsRow label="Menu bar" description="Show Computer in the menu bar" control={<Switch defaultChecked />} />
      </SettingsCard>
    </div>
  );
}
