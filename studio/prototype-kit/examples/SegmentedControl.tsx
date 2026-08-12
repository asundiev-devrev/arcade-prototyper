import React from "react";
import { SegmentedControl } from "../arcade-components";

export default (
  <SegmentedControl.Root type="single" defaultValue="center" aria-label="Text alignment">
    <SegmentedControl.Item value="left">Left</SegmentedControl.Item>
    <SegmentedControl.Item value="center">Center</SegmentedControl.Item>
    <SegmentedControl.Item value="right">Right</SegmentedControl.Item>
  </SegmentedControl.Root>
);
