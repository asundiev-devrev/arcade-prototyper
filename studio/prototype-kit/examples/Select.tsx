import React from "react";
import { Select } from "../arcade-components";

// Rendered open so the option list shows in the thumbnail.
export default (
  <div className="w-[240px]">
    <Select.Root defaultValue="banana" defaultOpen>
      <Select.Trigger aria-label="Choose fruit">
        <Select.Value />
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="apple">Apple</Select.Item>
        <Select.Item value="banana">Banana</Select.Item>
        <Select.Item value="cherry">Cherry</Select.Item>
        <Select.Item value="mango">Mango</Select.Item>
      </Select.Content>
    </Select.Root>
  </div>
);
