/**
 * Computer chat screen — assembled from DESIGN-SYSTEM LEAVES.
 *
 * `ComputerPage` stays: it only arranges slots (sidebar / header / body /
 * chatInput / panel) and injects no content of its own.
 *
 * What is deliberately NOT used here: `ComputerSidebar` and `ChatInput`. Those
 * composites render invented furniture by DEFAULT — a "New Chat" pill, a history
 * clock, window chrome with back/forward arrows, an "Agent Studio" wordmark — so
 * every screen inherited one fixed opinion of what a Computer sidebar contains,
 * and no prompt could talk them out of it. arcade-gen 2.0 ships the real parts
 * (`Sidebar.*`, `ChatComposer`, `ChatBubble`, `ThinkingBlock`), so the furniture
 * belongs in the frame where it can be varied per design.
 *
 * Build the sidebar and the composer out of leaves, like this.
 */
import React from "react";
import { ComputerPage } from "../templates/ComputerPage.js";
import { ComputerHeader } from "../composites/ComputerHeader.js";
import {
  Avatar,
  Bell,
  ChatBubble,
  ChatComposer,
  Clock,
  IconButton,
  PlusInChatBubble,
  Sidebar,
  ThinkingBlock,
  ThoughtStep,
} from "../arcade-components";

export default (
  <div className="h-[720px] w-[1200px]">
    <ComputerPage
      sidebar={
        <Sidebar.Root>
          {/* Header actions are the FRAME's choice, not a kit default. Drop them,
              or swap them, per the design you're building. */}
          <Sidebar.Header>
            <IconButton aria-label="New chat" variant="tertiary" size="sm">
              <PlusInChatBubble />
            </IconButton>
            <IconButton aria-label="History" variant="tertiary" size="sm">
              <Clock />
            </IconButton>
          </Sidebar.Header>

          {/* Conversations are HistoryItem — it carries the timestamp and the
              truncation Figma specifies. Plain Item is for everything else. */}
          <Sidebar.Section title="Sessions">
            <Sidebar.HistoryItem active timestamp="2:45 PM">
              Prepare marketing presentation
            </Sidebar.HistoryItem>
            <Sidebar.HistoryItem timestamp="Yesterday">
              Refresh the creative framework
            </Sidebar.HistoryItem>
          </Sidebar.Section>

          <Sidebar.Section title="Chats">
            <Sidebar.Item icon={<Avatar name="Shravan Goli" size="sm" />}>
              Shravan Goli
            </Sidebar.Item>
          </Sidebar.Section>

          <Sidebar.Footer>
            <Sidebar.Item icon={<Avatar name="Ava Wright" size="sm" />}>
              Ava Wright
            </Sidebar.Item>
          </Sidebar.Footer>
        </Sidebar.Root>
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
      // ChatComposer draws its own attach and send/stop buttons. Do not wrap it
      // in a slot that adds more.
      chatInput={<ChatComposer placeholder="Ask me anything" />}
    >
      <div className="flex flex-col gap-4 px-6 py-4">
        {/* `tail` on the LAST bubble of each speaker's run — it defaults to off,
            and without it a transcript is floating rectangles with no tails. */}
        <ChatBubble variant="sender" tail>
          Help me prepare the marketing presentation.
        </ChatBubble>

        <ThinkingBlock label="Thought for 4s">
          <ThoughtStep>Reviewed last quarter's deck</ThoughtStep>
          <ThoughtStep status="active">Drafting an outline</ThoughtStep>
        </ThinkingBlock>

        <ChatBubble variant="receiver" tail>
          Here's an outline built from last quarter's deck.
        </ChatBubble>
      </div>
    </ComputerPage>
  </div>
);
