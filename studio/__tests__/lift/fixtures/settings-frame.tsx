import { SettingsPage, SettingsCard, SettingsRow } from "arcade-prototypes";
import { Input, Button } from "arcade";

export default function ProfileSettings() {
  return (
    <SettingsPage title="Profile">
      <SettingsCard title="Basics">
        <SettingsRow label="Name"><Input value="Alice" onChange={() => {}} /></SettingsRow>
      </SettingsCard>
      <Button variant="primary">Save</Button>
    </SettingsPage>
  );
}
