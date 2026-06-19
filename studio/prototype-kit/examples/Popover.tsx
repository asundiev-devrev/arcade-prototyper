import React from "react";
import { Popover, Button } from "../arcade-components";

// Rendered open so the floating panel shows in the thumbnail.
export default (
  <Popover.Root defaultOpen>
    <Popover.Trigger asChild>
      <Button variant="secondary">Share</Button>
    </Popover.Trigger>
    <Popover.Content>
      <h4 className="mb-1 text-body-large text-(--fg-neutral-prominent)">
        Share workspace
      </h4>
      <p className="text-body-small text-(--fg-neutral-subtle)">
        Anyone with the link can view this project.
      </p>
    </Popover.Content>
  </Popover.Root>
);
