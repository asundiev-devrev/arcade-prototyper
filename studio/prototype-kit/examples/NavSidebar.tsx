import React from "react";
import { NavSidebar } from "../composites/NavSidebar.js";
import { Tag, HouseWithHorizontalLine, Flag, Buildings, Cog } from "../arcade-components";

export default (
  <div className="h-[480px] flex bg-(--surface-overlay)">
    <div className="w-60">
      <NavSidebar workspace="Acme Corp">
        <NavSidebar.Section title="Personal">
          <NavSidebar.Item icon={<HouseWithHorizontalLine size={16} />} label="My work" active />
          <NavSidebar.Item
            icon={<Flag size={16} />}
            label="Issues"
            trailing={<Tag intent="info">14</Tag>}
          />
        </NavSidebar.Section>
        <NavSidebar.Section title="Organization">
          <NavSidebar.Item icon={<Buildings size={16} />} label="Accounts" />
          <NavSidebar.Item icon={<Cog size={16} />} label="Settings" />
        </NavSidebar.Section>
      </NavSidebar>
    </div>
  </div>
);
