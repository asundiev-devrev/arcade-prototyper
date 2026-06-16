import React from "react";
import { ToggleGroup } from "../arcade-components";

export default (
  <ToggleGroup.Root type="single" defaultValue="center" aria-label="Text alignment">
    <ToggleGroup.Item value="left">Left</ToggleGroup.Item>
    <ToggleGroup.Item value="center">Center</ToggleGroup.Item>
    <ToggleGroup.Item value="right">Right</ToggleGroup.Item>
  </ToggleGroup.Root>
);
