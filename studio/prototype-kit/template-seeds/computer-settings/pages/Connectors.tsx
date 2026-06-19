import * as React from "react";
import { Tag } from "arcade/components";
import { BrandTile } from "../brandLogos";

const connectors: Array<{ name: string; connected?: boolean }> = [
  { name: "Gmail", connected: true }, { name: "Outlook Email", connected: true },
  { name: "Salesforce" }, { name: "HubSpot" },
  { name: "Google Calendar" }, { name: "Outlook Calendar" },
  { name: "Gong" }, { name: "Zoom", connected: true },
  { name: "Google Drive", connected: true }, { name: "Confluence Cloud" },
  { name: "Notion", connected: true }, { name: "OneDrive", connected: true },
  { name: "Slack", connected: true }, { name: "Microsoft Teams", connected: true },
  { name: "SharePoint", connected: true }, { name: "Jira" },
];

export default function Connectors() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {connectors.map((c) => (
          <div key={c.name} className="flex items-center justify-between rounded-square-x2 border px-4 py-3"
            style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
            <span className="flex items-center gap-3">
              <BrandTile name={c.name} />
              <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{c.name}</span>
            </span>
            {c.connected && <Tag intent="success" appearance="tinted">Connected</Tag>}
          </div>
        ))}
      </div>
    </div>
  );
}
