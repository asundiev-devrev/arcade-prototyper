import React from "react";
import { ChatMessages } from "../composites/ChatMessages.js";
import { ChatBubble } from "../arcade-components";

export default (
  <div className="w-[560px] bg-(--surface-overlay)">
    <ChatMessages>
      <ChatBubble variant="sender">
        Help me prep a marketing keynote for the Q3 launch.
      </ChatBubble>
      <ChatMessages.Agent thoughts={<ChatMessages.Thoughts label="Thought for 4s" />}>
        Here's a 5-act structure: open on the customer problem, frame the wedge, walk
        through the product, hand off to a live demo, and close on commercial signal.
        <ChatMessages.Actions />
      </ChatMessages.Agent>
      <ChatMessages.Agent
        thoughts={
          <ChatMessages.Thoughts label="Working" expanded>
            <ChatMessages.ThoughtItem subtitle="Q3 brief.pdf">
              Reading the launch brief
            </ChatMessages.ThoughtItem>
            <ChatMessages.ThoughtItem status="loading">
              Sketching slide structure
            </ChatMessages.ThoughtItem>
          </ChatMessages.Thoughts>
        }
      />
    </ChatMessages>
  </div>
);
