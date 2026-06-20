import * as React from "react";
import { Tag, Input, MagnifyingGlass } from "arcade/components";
import { BrandTile } from "../brandLogos";

type Status = "connected" | "attention";
type Connector = { name: string; description?: string; status?: Status };

const connectors: Connector[] = [
  { name: "Github", status: "attention" },
  { name: "Gmail", description: "Your inbox has the answers. Computer just helps you find them – instantly.", status: "connected" },
  { name: "Granola MCP", description: "Bring AI-powered meeting notes and conversation insights into DevRev.", status: "attention" },
  { name: "Notion MCP", description: "Bring Notion pages, databases, and workspace knowledge into Computer.", status: "attention" },
  { name: "Slack MCP", description: "Slack MCP", status: "connected" },
  { name: "Google Calendar", description: "What's coming up, what was discussed, where your time went – just ask Computer.", status: "connected" },
  { name: "Google Drive", description: "Find files and use them as working context.", status: "connected" },
  { name: "Notion", description: "Navigate pages, databases, and structured knowledge.", status: "connected" },
  { name: "Slack", description: "So much happens in Slack and then disappears. Computer keeps it findable.", status: "connected" },
  { name: "Jira", description: "Your team tracks everything in Jira. None of it should be invisible to Computer.", status: "connected" },
];

function StatusTag({ status }: { status?: Status }) {
  if (status === "connected") return <Tag intent="success" appearance="tinted">Connected</Tag>;
  if (status === "attention") return <Tag intent="warning" appearance="tinted">Needs attention</Tag>;
  return null;
}

function ConnectorCard({ connector }: { connector: Connector }) {
  return (
    <div
      className="flex flex-col gap-4 rounded-square-x2 border p-5"
      style={{ borderColor: "var(--stroke-neutral-subtle)" }}
    >
      <div className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-square" style={{ background: "var(--bg-neutral-soft)" }}>
          <BrandTile name={connector.name} />
        </span>
        <StatusTag status={connector.status} />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>{connector.name}</div>
        {connector.description && (
          <div className="text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>{connector.description}</div>
        )}
      </div>
    </div>
  );
}

export default function Connectors() {
  return (
    <div className="flex flex-col gap-6">
      <Input placeholder="Search" iconLeft={<MagnifyingGlass size={16} />} onChange={() => {}} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {connectors.map((c) => (<ConnectorCard key={c.name} connector={c} />))}
      </div>
    </div>
  );
}
