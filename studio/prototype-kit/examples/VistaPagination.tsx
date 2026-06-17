import React from "react";
import { VistaPagination } from "../composites/VistaPagination.js";

export default (
  <div className="w-[820px] bg-(--surface-overlay)">
    <VistaPagination
      pageSize="50"
      rangeLabel="1–50 of 16,538"
      onPrev={() => {}}
      onNext={() => {}}
      canPrev={false}
    />
  </div>
);
