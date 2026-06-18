import * as React from "react";
import { VistaPage, VistaFilterPill, VistaPagination, VistaRow } from "arcade-prototypes";
import { Button, IconButton, Avatar, Tag, Input } from "arcade/components";
import { MagnifyingGlass, PlusSmall, ChevronRightSmall } from "arcade/components";

const tickets = [
  { id: "TKT-42", title: "Investigate API timeouts on export", stage: "Open", assignee: "Alice Nguyen" },
  { id: "TKT-43", title: "Crash on launch after 0.36 update", stage: "In progress", assignee: "Bob Marsh" },
  { id: "TKT-44", title: "Add bulk-archive to the inbox", stage: "Open", assignee: "Carla Diaz" },
  { id: "TKT-45", title: "Webhook retries fire twice", stage: "In review", assignee: "Dan Okoro" },
  { id: "TKT-46", title: "Dark-mode contrast on filter pills", stage: "Open", assignee: "Eve Larsen" },
];

export default function AppListTemplate() {
  return (
    <VistaPage
      title="Tickets"
      count={tickets.length}
      primaryAction={
        <Button variant="primary" size="sm" iconLeft={<PlusSmall size={16} />}>
          New ticket
        </Button>
      }
      actions={
        <IconButton variant="tertiary" size="sm" aria-label="Search">
          <MagnifyingGlass size={16} />
        </IconButton>
      }
      filters={<VistaFilterPill label="Status: Open" />}
    >
      <div className="flex w-full flex-col">
        <div className="px-9 py-3">
          <Input placeholder="Search tickets" />
        </div>
        {tickets.map((t) => (
          <VistaRow key={t.id} stage={t.stage}>
            <span>{t.title}</span>
            <Tag intent="neutral">{t.stage}</Tag>
            <Avatar name={t.assignee} size="sm" />
            <ChevronRightSmall size={16} />
          </VistaRow>
        ))}
        <VistaPagination total={tickets.length} />
      </div>
    </VistaPage>
  );
}
