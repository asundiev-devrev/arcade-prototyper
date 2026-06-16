import React from "react";
import { Banner } from "../arcade-components";

export default (
  <div className="w-[480px]">
    <Banner
      intent="info"
      action={{ label: "Upgrade", onClick: () => {} }}
      onDismiss={() => {}}
    >
      You are approaching your plan's seat limit.
    </Banner>
  </div>
);
