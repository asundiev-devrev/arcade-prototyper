import React from "react";
import { Chart } from "../arcade-components";

export default (
  <div style={{ height: 320, width: 480 }}>
    <Chart.Bar
      data={[
        { name: "Engineering", values: [45] },
        { name: "Design", values: [32] },
        { name: "Product", values: [28] },
        { name: "Sales", values: [52] },
        { name: "Support", values: [38] },
      ]}
      series={[{ key: "values", name: "Headcount" }]}
      title="Team size by department"
    />
  </div>
);
