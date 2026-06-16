import React from "react";
import { SettingsRow } from "../composites/SettingsRow.js";
import { Switch } from "../arcade-components";

export default (
  <SettingsRow
    label="Email notifications"
    description="Receive a digest when something changes"
    control={<Switch defaultChecked />}
  />
);
