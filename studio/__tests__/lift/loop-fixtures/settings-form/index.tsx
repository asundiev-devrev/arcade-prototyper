import * as React from "react";
import { SettingsPage, SettingsCard, SettingsRow } from "arcade-prototypes";
import { Input, Select, Checkbox, Button } from "arcade/components";

export default function ProfileSettingsForm() {
  return (
    <SettingsPage title="Profile">
      <SettingsCard title="Basics">
        <SettingsRow label="Name">
          <Input value="Alice" onChange={() => {}} />
        </SettingsRow>
        <SettingsRow label="Timezone">
          <Select value="UTC" onChange={() => {}} />
        </SettingsRow>
        <SettingsRow label="Subscribe to updates">
          <Checkbox checked onChange={() => {}} />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard title="Security">
        <SettingsRow label="Require 2FA">
          <Checkbox checked={false} onChange={() => {}} />
        </SettingsRow>
      </SettingsCard>
      <div className="mt-4 flex gap-2">
        <Button variant="tertiary">Cancel</Button>
        <Button variant="primary">Save changes</Button>
      </div>
    </SettingsPage>
  );
}
