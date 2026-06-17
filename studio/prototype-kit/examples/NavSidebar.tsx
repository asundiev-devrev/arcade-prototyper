import React from "react";
import { NavSidebar } from "../composites/NavSidebar.js";
import { Bell, Document, TwoHumanSilhouettes, Window, MagnifyingGlassInSquare } from "../arcade-components";

export default (
  <div className="h-[560px] flex bg-(--surface-overlay)">
    <div className="w-60">
      <NavSidebar>
        <NavSidebar.Section title="Work">
          <NavSidebar.Item icon={<Bell size={16} />} label="Updates" />
          <NavSidebar.Item icon={<Document size={16} />} label="My tasks" />
        </NavSidebar.Section>
        <NavSidebar.Section title="Teams">
          <NavSidebar.Item
            icon={<TwoHumanSilhouettes size={16} />}
            label="Foundations"
            trailing={<NavSidebar.ExpandChevron expanded />}
          />
          <NavSidebar.Item icon={<Window size={16} />} label="Lobby" indent />
          <NavSidebar.Item icon={<Window size={16} />} label="Issues" indent active />
          <NavSidebar.Item icon={<Window size={16} />} label="Roadmap" indent />
          <NavSidebar.Item icon={<Window size={16} />} label="Sprints" indent />
        </NavSidebar.Section>
        <NavSidebar.Section title="Views">
          <NavSidebar.Item icon={<Window size={16} />} label="Trails" />
          <NavSidebar.Item icon={<Window size={16} />} label="Now, next, later" />
        </NavSidebar.Section>
        <NavSidebar.Section>
          <NavSidebar.Item icon={<MagnifyingGlassInSquare size={16} />} label="Explore" />
        </NavSidebar.Section>
      </NavSidebar>
    </div>
  </div>
);
