import React from "react";
import { Grid } from "../arcade-components";

const Cell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-16 items-center justify-center rounded-(--corner-square) bg-(--surface-shallow) p-4 text-system text-(--fg-neutral-prominent)">
    {children}
  </div>
);

export default (
  <div className="w-[420px]">
    <Grid cols={3} gap="md">
      <Grid.Item>
        <Cell>Inbox</Cell>
      </Grid.Item>
      <Grid.Item>
        <Cell>Drafts</Cell>
      </Grid.Item>
      <Grid.Item>
        <Cell>Sent</Cell>
      </Grid.Item>
      <Grid.Item>
        <Cell>Archive</Cell>
      </Grid.Item>
      <Grid.Item>
        <Cell>Spam</Cell>
      </Grid.Item>
      <Grid.Item>
        <Cell>Trash</Cell>
      </Grid.Item>
    </Grid>
  </div>
);
