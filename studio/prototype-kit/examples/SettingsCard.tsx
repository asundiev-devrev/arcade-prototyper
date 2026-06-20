import React from "react";
import { SettingsCard } from "../composites/SettingsCard.js";
import { SettingsRow } from "../composites/SettingsRow.js";
import { Switch, Button } from "../arcade-components";

export default (
  <div className="w-[640px] p-6 bg-(--surface-overlay)">
    <SettingsCard title="Security">
      <SettingsRow
        label="Two-factor authentication"
        description="Require a code from your phone at sign-in"
        control={<Switch defaultChecked />}
      />
      <SettingsRow
        label="Active sessions"
        description="You're signed in on 3 devices"
        action={<Button variant="secondary">Manage</Button>}
      />
      <SettingsRow
        label="Single sign-on"
        description="Let members sign in with your identity provider"
        control={<Switch />}
      />
    </SettingsCard>
  </div>
);
