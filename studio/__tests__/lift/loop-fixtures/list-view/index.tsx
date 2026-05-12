import * as React from "react";
import { VistaPage, VistaFilterPill, VistaPagination, VistaRow } from "arcade-prototypes";
import { Button, IconButton, Avatar, Tag, Input } from "arcade/components";
import { MagnifyingGlass, PlusSmall, ChevronRightSmall } from "arcade/components";

const tickets = [
  { id: "TKT-42", title: "Investigate timeouts", stage: "Open", assignee: "Alice" },
  { id: "TKT-43", title: "Crash on launch", stage: "In progress", assignee: "Bob" },
];

export default function TicketsList() {
  return (
    <VistaPage
      title="Tickets"
      count={tickets.length}
      primaryAction={
        <Button variant="primary" size="sm" iconLeft={<PlusSmall size={16} />}>
          New ticket
        </Button>
      }
      toolbarIcons={
        <IconButton variant="tertiary" size="sm" aria-label="Search">
          <MagnifyingGlass size={16} />
        </IconButton>
      }
      filters={<VistaFilterPill label="Status: Open" />}
    >
      <Input placeholder="Search" />
      {tickets.map((t) => (
        <VistaRow key={t.id} stage={t.stage}>
          <span>{t.title}</span>
          <Tag intent="neutral">{t.stage}</Tag>
          <Avatar name={t.assignee} size="sm" />
          <ChevronRightSmall size={16} />
        </VistaRow>
      ))}
      <VistaPagination total={tickets.length} />
    </VistaPage>
  );
}
