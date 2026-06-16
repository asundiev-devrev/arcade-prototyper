import React from "react";
import { VistaToolbar } from "../composites/VistaToolbar.js";
import { VistaFilterPill } from "../composites/VistaFilterPill.js";
import { AtSymbol, ChartLineInSquare, Clock } from "../arcade-components";

export default (
  <div className="w-[820px] py-4 bg-(--surface-overlay)">
    <VistaToolbar
      toolbarIcons={
        <>
          <VistaToolbar.IconAction icon={<AtSymbol />} label="Mentions" />
          <VistaToolbar.IconAction icon={<ChartLineInSquare />} label="Insights" />
          <VistaToolbar.IconAction icon={<Clock />} label="Recent" />
        </>
      }
      filters={
        <>
          <VistaFilterPill icon={<Clock />} label="Created date" value="last 30 days" onRemove={() => {}} />
          <VistaFilterPill.Add />
          <VistaFilterPill.Clear />
        </>
      }
    />
  </div>
);
