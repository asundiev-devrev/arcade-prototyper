import React from "react";
import { TextArea } from "../arcade-components";

export default (
  <div className="w-[360px]">
    <TextArea
      label="Description"
      rows={4}
      defaultValue="Customer experience agent that triages inbound tickets and drafts replies."
      helperText="Describe what this agent does."
    />
  </div>
);
