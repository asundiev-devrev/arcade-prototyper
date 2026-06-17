import React from "react";
import { Checkbox } from "../arcade-components";

export default (
  <div className="flex flex-col gap-3">
    <Checkbox label="Notify me about replies" defaultChecked />
    <Checkbox label="Subscribe to product updates" />
  </div>
);
