import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Select } from "arcade/components";

export default function Preferences() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title="General">
        <SettingsRow
          label="Timezone"
          description="Reminders, notifications and emails are delivered based on your time zone."
          control={
            <Select.Root defaultValue="india">
              <Select.Trigger><Select.Value placeholder="India - (GMT+05:30)" /></Select.Trigger>
              <Select.Content>
                <Select.Item value="india">India - (GMT+05:30)</Select.Item>
                <Select.Item value="pst">Pacific - (GMT-08:00)</Select.Item>
                <Select.Item value="est">Eastern - (GMT-05:00)</Select.Item>
                <Select.Item value="utc">UTC - (GMT+00:00)</Select.Item>
              </Select.Content>
            </Select.Root>
          }
        />
        <SettingsRow
          label="Organization language settings"
          description="Select a default language for your org"
          control={
            <Select.Root defaultValue="en-us" disabled>
              <Select.Trigger><Select.Value placeholder="English (United States)" /></Select.Trigger>
              <Select.Content>
                <Select.Item value="en-us">English (United States)</Select.Item>
              </Select.Content>
            </Select.Root>
          }
        />
        <SettingsRow
          label="User language settings"
          description="Select a default language for yourself"
          control={
            <Select.Root defaultValue="en-us">
              <Select.Trigger><Select.Value placeholder="English (United States)" /></Select.Trigger>
              <Select.Content>
                <Select.Item value="en-us">English (United States)</Select.Item>
                <Select.Item value="en-gb">English (United Kingdom)</Select.Item>
                <Select.Item value="fr">Français</Select.Item>
                <Select.Item value="de">Deutsch</Select.Item>
              </Select.Content>
            </Select.Root>
          }
        />
      </SettingsCard>
    </div>
  );
}
