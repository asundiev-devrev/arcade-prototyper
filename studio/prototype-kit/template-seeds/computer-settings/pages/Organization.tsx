import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Input, Avatar, Button } from "arcade/components";

export default function Organization() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard title="Organization profile">
        <SettingsRow label="Logo" control={<Avatar name="Maple AI" size="md" />} action={<Button variant="tertiary" size="sm">Change</Button>} />
        <SettingsRow label="Organization name" control={<Input defaultValue="Maple AI" onChange={() => {}} />} />
        <SettingsRow label="Domain" control={<Input defaultValue="maple.ai" onChange={() => {}} />} />
      </SettingsCard>
      <SettingsCard title="Danger zone">
        <SettingsRow label="Delete organization" description="Remove this organization and all of its data."
          action={<Button variant="tertiary" size="sm">Delete organization</Button>} />
      </SettingsCard>
    </div>
  );
}
