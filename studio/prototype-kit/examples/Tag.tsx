import React from "react";
import { Tag } from "../arcade-components";

export default (
  <div className="flex items-center gap-2">
    <Tag intent="success">Resolved</Tag>
    <Tag intent="warning">At risk</Tag>
    <Tag intent="info">Enterprise</Tag>
    <Tag intent="neutral" onDismiss={() => {}}>
      regression
    </Tag>
  </div>
);
