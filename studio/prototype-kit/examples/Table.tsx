import React from "react";
import { Table } from "../arcade-components";

const rows = [
  { name: "API Gateway", status: "Active", priority: "High" },
  { name: "Auth Service", status: "Active", priority: "Critical" },
  { name: "Dashboard UI", status: "In progress", priority: "Medium" },
  { name: "Search Indexer", status: "Planned", priority: "Low" },
];

export default (
  <div className="w-[480px]">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Service</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head>Priority</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((r) => (
          <Table.Row key={r.name}>
            <Table.Cell>{r.name}</Table.Cell>
            <Table.Cell>{r.status}</Table.Cell>
            <Table.Cell>{r.priority}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  </div>
);
