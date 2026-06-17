import React from "react";
import { ComputerPage } from "../templates/ComputerPage.js";
import { ComputerSidebar } from "../composites/ComputerSidebar.js";
import { ComputerHeader } from "../composites/ComputerHeader.js";
import { ChatMessages } from "../composites/ChatMessages.js";
import { ChatInput } from "../composites/ChatInput.js";
import { Avatar, IconButton, ChatBubble, Bell, AtSymbol } from "../arcade-components";

export default (
  <div className="h-[720px] w-[1200px]">
    <ComputerPage
      sidebar={
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
          </ComputerSidebar.Group>
        </ComputerSidebar>
      }
      header={
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
      }
      chatInput={
        <ChatInput
          placeholder="Ask me anything"
          trailing={
            <>
              <ChatInput.AddAttachmentButton aria-label="Attach" />
              <ChatInput.SendButton />
            </>
          }
        />
      }
    >
      <ChatMessages>
        <ChatBubble variant="sender">
          Help me prep a marketing keynote for the Q3 launch.
        </ChatBubble>
        <ChatMessages.Agent thoughts={<ChatMessages.Thoughts label="Thought for 4s" />}>
          Here's a 5-act structure: open on the customer problem, frame the wedge,
          walk through the product, hand off to a live demo, and close on commercial
          signal.
          <ChatMessages.Actions />
        </ChatMessages.Agent>
      </ChatMessages>
    </ComputerPage>
  </div>
);
