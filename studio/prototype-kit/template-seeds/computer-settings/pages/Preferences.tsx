import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Select, Switch } from "arcade/components";

export default function Preferences() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title="Appearance">
        <SettingsRow label="Theme" description="Choose how Computer looks." control={<Select value="System" onChange={() => {}} />} />
        <SettingsRow label="Language" control={<Select value="English (US)" onChange={() => {}} />} />
      </SettingsCard>
      <SettingsCard title="Notifications">
        <SettingsRow label="Email notifications" description="Get notified about activity by email." control={<Switch defaultChecked />} />
        <SettingsRow label="Desktop notifications" control={<Switch />} />
      </SettingsCard>
    </div>
  );
}
