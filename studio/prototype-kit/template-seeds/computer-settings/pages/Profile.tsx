import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Input, Avatar, Button } from "arcade/components";

export default function Profile() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title="Personal information">
        <SettingsRow label="Photo" control={<Avatar name="Ben Carter" size="md" />} action={<Button variant="tertiary" size="sm">Change</Button>} />
        <SettingsRow label="Name" control={<Input defaultValue="Ben Carter" onChange={() => {}} />} />
        <SettingsRow label="Email" control={<Input defaultValue="ben@maple.ai" onChange={() => {}} />} />
      </SettingsCard>
      <SettingsCard title="Danger zone">
        <SettingsRow label="Delete account" description="Permanently remove your account and all data."
          action={<Button variant="tertiary" size="sm">Delete account</Button>} />
      </SettingsCard>
    </div>
  );
}
