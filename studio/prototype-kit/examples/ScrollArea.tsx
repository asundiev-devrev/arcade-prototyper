import React from "react";
import { ScrollArea } from "../arcade-components";

export default (
  <ScrollArea aria-label="Release notes" style={{ height: 200, width: 320 }}>
    <div className="flex flex-col gap-3 p-4 text-body text-(--fg-neutral-prominent)">
      {Array.from({ length: 12 }, (_, i) => (
        <p key={i}>
          Release 2.{i} — performance improvements, bug fixes, and refreshed
          empty states across the workspace.
        </p>
      ))}
    </div>
  </ScrollArea>
);
