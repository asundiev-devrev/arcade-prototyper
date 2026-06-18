import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Select, Switch } from "arcade/components";

export default function Preferences() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title="Appearance">
        <SettingsRow label="Theme" description="Choose how Computer looks." control={
          <Select.Root defaultValue="system">
            <Select.Trigger><Select.Value placeholder="System" /></Select.Trigger>
            <Select.Content>
              <Select.Item value="system">System</Select.Item>
              <Select.Item value="light">Light</Select.Item>
              <Select.Item value="dark">Dark</Select.Item>
            </Select.Content>
          </Select.Root>
        } />
        <SettingsRow label="Language" control={
          <Select.Root defaultValue="en-us">
            <Select.Trigger><Select.Value placeholder="English (US)" /></Select.Trigger>
            <Select.Content>
              <Select.Item value="en-us">English (US)</Select.Item>
              <Select.Item value="en-gb">English (UK)</Select.Item>
              <Select.Item value="fr">Français</Select.Item>
            </Select.Content>
          </Select.Root>
        } />
      </SettingsCard>
      <SettingsCard title="Notifications">
        <SettingsRow label="Email notifications" description="Get notified about activity by email." control={<Switch defaultChecked />} />
        <SettingsRow label="Desktop notifications" control={<Switch />} />
      </SettingsCard>
    </div>
  );
}
