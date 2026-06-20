import React from "react";
import { ChatInput } from "../composites/ChatInput.js";
import { AtSymbol } from "../arcade-components";

export default (
  <div className="w-[560px] bg-(--surface-overlay)">
    <ChatInput
      placeholder="Ask me anything"
      attachments={
        <>
          <ChatInput.ContextAttachment icon={<AtSymbol size={16} />} title="Q3 Strategy" subtitle="Notion" />
          <ChatInput.FileAttachment kind="PDF" name="Launch brief.pdf" />
          <ChatInput.FileAttachment kind="DOCX" name="Slide outline.docx" progress={40} />
        </>
      }
      trailing={
        <>
          <ChatInput.AddAttachmentButton aria-label="Attach" />
          <ChatInput.SendButton />
        </>
      }
    />
  </div>
);
