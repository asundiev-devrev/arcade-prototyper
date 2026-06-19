import React from "react";
import { ResizablePanel } from "../arcade-components";

export default (
  <div className="h-[220px] w-[480px] overflow-hidden rounded-(--corner-square) border border-(--stroke-neutral-subtle)">
    <ResizablePanel.Group direction="horizontal">
      <ResizablePanel.Panel initialWidth={180} minWidth={120} maxWidth={300}>
        <div className="h-full bg-(--surface-shallow) p-4 text-body-small text-(--fg-neutral-prominent)">
          Navigation
        </div>
      </ResizablePanel.Panel>
      <ResizablePanel.Handle aria-label="Resize panel" />
      <ResizablePanel.Panel>
        <div className="h-full bg-(--surface-overlay) p-4 text-body-small text-(--fg-neutral-prominent)">
          Editor
        </div>
      </ResizablePanel.Panel>
    </ResizablePanel.Group>
  </div>
);
