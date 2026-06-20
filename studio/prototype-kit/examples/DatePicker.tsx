import React from "react";
import { DatePicker } from "../arcade-components";

export default (
  <div className="w-[240px]">
    <DatePicker value={new Date(2026, 3, 10)} placeholder="Select a date" />
  </div>
);
