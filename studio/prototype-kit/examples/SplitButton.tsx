import React from "react";
import { SplitButton, SplitButtonItem, PlusSmall, ChevronDownSmall } from "../arcade-components";

export default (
  <SplitButton variant="secondary">
    <SplitButtonItem icon={<PlusSmall size={16} />}>New issue</SplitButtonItem>
    <SplitButtonItem iconRight={<ChevronDownSmall size={16} />} aria-label="More create options" />
  </SplitButton>
);
