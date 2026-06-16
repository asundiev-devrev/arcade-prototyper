import React from "react";
import { ComputerHeader } from "../composites/ComputerHeader.js";
import { Avatar, IconButton, Bell } from "../arcade-components";

export default (
  <div className="w-[560px] bg-(--surface-overlay)">
    <ComputerHeader
      title="Prepare marketing presentation"
      actions={
        <>
          <Avatar name="Shravan" size="sm" />
          <IconButton aria-label="Notifications" variant="tertiary">
            <Bell size={16} />
          </IconButton>
        </>
      }
    />
  </div>
);
