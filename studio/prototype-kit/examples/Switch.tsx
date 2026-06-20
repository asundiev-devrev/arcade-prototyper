import React from "react";
import { Switch } from "../arcade-components";

export default (
  <div className="flex flex-col gap-3">
    <Switch label="Email notifications" defaultChecked />
    <Switch label="Weekly digest" />
  </div>
);
