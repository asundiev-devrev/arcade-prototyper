import React from "react";
import { Input } from "../arcade-components";

export default (
  <div className="w-[320px]">
    <Input
      label="Workspace name"
      placeholder="Acme Corp"
      defaultValue="Acme Corp"
      helperText="This appears in the sidebar and on invites."
    />
  </div>
);
