import React from "react";
import { VistaGroupRail } from "../composites/VistaGroupRail.js";

export default (
  <div className="bg-(--surface-overlay) py-2">
    <VistaGroupRail>
      <VistaGroupRail.Item label="P0" count={1} selected />
      <VistaGroupRail.Item label="P1" count={15} />
      <VistaGroupRail.Item label="P2" count={13} />
      <VistaGroupRail.Item label="P3" count={17} />
    </VistaGroupRail>
  </div>
);
