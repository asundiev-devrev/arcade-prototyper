import React from "react";
import { TitleBar } from "../composites/TitleBar.js";
import { IconButton, Avatar, MagnifyingGlass, Bell } from "../arcade-components";

export default (
  <TitleBar
    trailingActions={
      <>
        <IconButton aria-label="Search" variant="tertiary">
          <MagnifyingGlass size={16} />
        </IconButton>
        <IconButton aria-label="Notifications" variant="tertiary">
          <Bell size={16} />
        </IconButton>
        <Avatar name="Ava Wright" size="sm" />
      </>
    }
  />
);
