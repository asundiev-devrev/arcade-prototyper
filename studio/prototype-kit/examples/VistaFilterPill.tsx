import React from "react";
import { VistaFilterPill } from "../composites/VistaFilterPill.js";
import { Clock, Flag } from "../arcade-components";

export default (
  <div className="flex items-center gap-2 p-4 bg-(--surface-overlay)">
    <VistaFilterPill
      icon={<Clock />}
      label="Created date"
      value="last 30 days"
      onRemove={() => {}}
    />
    <VistaFilterPill icon={<Flag />} label="Stage" value="In progress" onRemove={() => {}} />
    <VistaFilterPill.Add />
    <VistaFilterPill.Clear />
  </div>
);
