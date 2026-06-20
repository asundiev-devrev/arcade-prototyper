import React from "react";
import { Dashboard, Widget } from "../arcade-components";

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex h-full flex-col justify-center">
    <span className="text-title-2 text-(--fg-neutral-prominent)">{value}</span>
    <span className="text-system text-(--fg-neutral-subtle)">{label}</span>
  </div>
);

export default (
  <div className="h-[360px] w-[640px] bg-(--surface-overlay) p-4">
    <Dashboard>
      <Dashboard.Grid cols={12}>
        <Dashboard.Widget id="revenue" x={0} y={0} w={6} h={3}>
          <Widget.Root>
            <Widget.Header>
              <h3 className="text-system-large font-bold text-(--fg-neutral-prominent)">
                Revenue
              </h3>
            </Widget.Header>
            <Widget.Body>
              <Stat label="this month" value="$48.2K" />
            </Widget.Body>
          </Widget.Root>
        </Dashboard.Widget>
        <Dashboard.Widget id="users" x={6} y={0} w={6} h={3}>
          <Widget.Root>
            <Widget.Header>
              <h3 className="text-system-large font-bold text-(--fg-neutral-prominent)">
                Active users
              </h3>
            </Widget.Header>
            <Widget.Body>
              <Stat label="last 7 days" value="3,140" />
            </Widget.Body>
          </Widget.Root>
        </Dashboard.Widget>
      </Dashboard.Grid>
    </Dashboard>
  </div>
);
