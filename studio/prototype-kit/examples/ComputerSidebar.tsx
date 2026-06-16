import React from "react";
import { ComputerSidebar } from "../composites/ComputerSidebar.js";
import { Avatar } from "../arcade-components";

export default (
  <div className="h-[480px] flex bg-(--surface-backdrop)">
    <ComputerSidebar
      user={
        <ComputerSidebar.User
          name="Ava Wright"
          subtitle="DevRev"
          avatar={<Avatar name="Ava Wright" size="md" />}
        />
      }
    >
      <ComputerSidebar.Group title="Sessions">
        <ComputerSidebar.Item active emphasis="strong">
          Prepare marketing presentation
        </ComputerSidebar.Item>
        <ComputerSidebar.Item emphasis="strong">
          Refresh the creative framework
        </ComputerSidebar.Item>
        <ComputerSidebar.Item>Project sync-up agenda</ComputerSidebar.Item>
      </ComputerSidebar.Group>

      <ComputerSidebar.Group title="Chats">
        <ComputerSidebar.Item leading={<Avatar name="Shravan" size="sm" />}>
          Shravan
        </ComputerSidebar.Item>
        <ComputerSidebar.Item leading={<Avatar name="Samantha" size="sm" />}>
          Samantha
        </ComputerSidebar.Item>
      </ComputerSidebar.Group>
    </ComputerSidebar>
  </div>
);
