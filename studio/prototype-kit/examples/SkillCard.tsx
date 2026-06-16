import React from "react";
import { SkillCard } from "../composites/SkillCard.js";
import { IconButton, PlusSmall, Mcp } from "../arcade-components";

export default (
  <div className="w-[280px]">
    <SkillCard
      icon={<Mcp size={20} />}
      action={
        <IconButton aria-label="Add" variant="tertiary">
          <PlusSmall size={16} />
        </IconButton>
      }
      title="Notion"
      description="Your docs and wikis, finally findable."
      status={
        <>
          <span className="w-1.5 h-1.5 rounded-circle bg-(--bg-success-prominent)" />
          Connected
        </>
      }
    />
  </div>
);
