import React from "react";
import { Widget } from "../arcade-components";

export default (
  <div className="w-[320px]">
    <Widget.Root>
      <Widget.Header>
        <h3 className="text-system-large font-bold text-(--fg-neutral-prominent)">
          Monthly revenue
        </h3>
      </Widget.Header>
      <Widget.Body>
        <div className="flex items-baseline gap-2">
          <span className="text-title-1 text-(--fg-neutral-prominent)">$48.2K</span>
          <span className="text-body-small text-(--fg-success-prominent)">+12%</span>
        </div>
      </Widget.Body>
      <Widget.Footer>
        <span className="text-system text-(--fg-neutral-subtle)">Updated 5 min ago</span>
      </Widget.Footer>
    </Widget.Root>
  </div>
);
