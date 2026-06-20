import React from "react";
import { PickerModal } from "../composites/PickerModal.js";
import { CardGrid } from "../composites/CardGrid.js";
import { SkillCard } from "../composites/SkillCard.js";
import { Mcp, Book } from "../arcade-components";

export default (
  <PickerModal
    open
    title="Agent Capabilities"
    subtitle="Pick the skills and tools your agent can use."
    tabs={[
      {
        value: "skills",
        label: "Skills",
        content: (
          <CardGrid columns={2}>
            <SkillCard
              icon={<Book size={20} />}
              title="Prospect Research"
              description="Pulls a company brief before any outbound call."
            />
            <SkillCard
              icon={<Mcp size={20} />}
              title="Summarize Thread"
              description="Condenses a long conversation into action items."
            />
          </CardGrid>
        ),
      },
      {
        value: "tools",
        label: "Tools",
        content: (
          <CardGrid columns={2}>
            <SkillCard icon={<Mcp size={20} />} title="Notion" description="Your docs and wikis." />
          </CardGrid>
        ),
      },
    ]}
  />
);
