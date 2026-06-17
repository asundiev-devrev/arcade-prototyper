import React from "react";
import { ChatBubble } from "../arcade-components";

export default (
  <div className="flex w-[360px] flex-col gap-2">
    <ChatBubble variant="receiver" tail timestamp="9:41 AM">
      Can you help me set up single sign-on?
    </ChatBubble>
    <ChatBubble variant="sender" tail timestamp="9:42 AM">
      Of course — head to Settings → Security and select your identity provider.
    </ChatBubble>
  </div>
);
