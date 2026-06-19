import React from "react";
import { PageBody } from "../composites/PageBody.js";
import { SettingsCard } from "../composites/SettingsCard.js";
import { SettingsRow } from "../composites/SettingsRow.js";
import { Switch, Button } from "../arcade-components";

export default (
  <PageBody
    title="Notifications"
    subtitle="Choose how and when you hear from your workspace."
    titleAction={<Button variant="primary">Save changes</Button>}
  >
    <SettingsCard title="Email">
      <SettingsRow
        label="Weekly digest"
        description="A summary of activity every Monday"
        control={<Switch defaultChecked />}
      />
      <SettingsRow
        label="Mentions"
        description="Email me when someone @-mentions me"
        control={<Switch />}
      />
    </SettingsCard>
  </PageBody>
);
