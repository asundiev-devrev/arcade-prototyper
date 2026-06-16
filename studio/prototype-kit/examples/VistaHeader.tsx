import React from "react";
import { VistaHeader } from "../composites/VistaHeader.js";
import { MagnifyingGlass, ArrowsUpAndDown, PlusSmall } from "../arcade-components";

export default (
  <div className="w-[820px] bg-(--surface-overlay)">
    <VistaHeader
      title="All issues"
      count="16,538"
      actions={
        <>
          <VistaHeader.Action icon={<MagnifyingGlass />} label="Search" />
          <VistaHeader.Action icon={<ArrowsUpAndDown />} label="Sort" />
        </>
      }
      primaryAction={
        <VistaHeader.PrimaryAction icon={<PlusSmall />}>Issue</VistaHeader.PrimaryAction>
      }
    />
  </div>
);
