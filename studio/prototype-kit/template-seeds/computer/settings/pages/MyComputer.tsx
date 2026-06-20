import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Tabs, Switch, Button, Computer, PlusSmall } from "arcade/components";

function GeneralEmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-24 text-center">
      <Computer size={36} color="var(--fg-neutral-prominent)" />
      <h3 className="text-title-2" style={{ color: "var(--fg-neutral-prominent)" }}>My Computer coming soon</h3>
      <p className="max-w-md text-body-large" style={{ color: "var(--fg-neutral-subtle)" }}>
        Computer works better when it knows you. Add instructions, shape its memory, and tune how it shows up.
      </p>
      <div className="mt-2">
        <Button variant="tertiary" size="md">Learn More</Button>
      </div>
    </div>
  );
}

function DesktopAppSettings() {
  return (
    <SettingsCard title="General settings">
      <SettingsRow label="Run on start up" description="Automatically start Computer on start up" control={<Switch defaultChecked />} />
      <SettingsRow label="File Directory" description="Where Computer saves your files and skills."
        action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>/Users/Shashank.Sin…</Button>} />
      <SettingsRow label="Quick access short cut" description="Bring Computer to your attention quickly"
        action={<span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Manage</span>} control={<Switch defaultChecked />} />
      <SettingsRow label="Menu bar" description="Show Computer in the menu bar" control={<Switch defaultChecked />} />
    </SettingsCard>
  );
}

export default function MyComputer() {
  return (
    <Tabs.Root defaultValue="general" className="flex flex-col gap-6">
      <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.List>
          <Tabs.Trigger value="general">General</Tabs.Trigger>
          <Tabs.Trigger value="desktop">Desktop app</Tabs.Trigger>
        </Tabs.List>
      </div>
      <Tabs.Content value="general">
        <GeneralEmptyState />
      </Tabs.Content>
      <Tabs.Content value="desktop">
        <DesktopAppSettings />
      </Tabs.Content>
    </Tabs.Root>
  );
}
