import React from "react";
import { Dropdown, Checkbox, Button } from "../arcade-components";

// Rendered open so the filter panel shows in the thumbnail.
export default (
  <Dropdown.Root defaultOpen>
    <Dropdown.Trigger asChild>
      <Button variant="secondary">Filters</Button>
    </Dropdown.Trigger>
    <Dropdown.Content>
      <h4 className="mb-2 text-body-large text-(--fg-neutral-prominent)">Filters</h4>
      <div className="flex flex-col gap-2">
        <Checkbox label="Status: Active" defaultChecked />
        <Checkbox label="Priority: High" />
        <Checkbox label="Assigned to me" />
      </div>
    </Dropdown.Content>
  </Dropdown.Root>
);
