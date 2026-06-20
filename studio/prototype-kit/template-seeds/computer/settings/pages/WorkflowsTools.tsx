import * as React from "react";
import { Tabs, Button, IconButton, Mcp, TwoSquaresOverlapping, MagnifyingGlass, PlusSmall, ChevronDownSmall, ThreeDotsHorizontal } from "arcade/components";

type Row = { name: string; type: "Workflow" | "Tool" };

const rows: Row[] = [
  { name: "GetTimelineSummary", type: "Workflow" },
  { name: "UpdateGoal", type: "Tool" },
  { name: "CreateGoal", type: "Tool" },
  { name: "DatadogQuery", type: "Workflow" },
  { name: "CreateArticle", type: "Tool" },
  { name: "UpdateLinkedInFollowerInteraction", type: "Tool" },
  { name: "CreateLinkedInFollowerInteraction", type: "Tool" },
  { name: "GetContactEmail", type: "Workflow" },
  { name: "CreateOpportunity", type: "Tool" },
  { name: "AccountLinkedinScrapeSkill", type: "Workflow" },
  { name: "RevOpsCreateAccount", type: "Workflow" },
  { name: "ContactLinkedinScrapeSkill", type: "Workflow" },
  { name: "GetMeeting", type: "Tool" },
  { name: "UpdateProduct", type: "Tool" },
  { name: "WebSearch", type: "Tool" },
];

function ToolbarButton({ children, ariaLabel }: { children: React.ReactNode; ariaLabel: string }) {
  return <IconButton variant="tertiary" size="sm" aria-label={ariaLabel}>{children}</IconButton>;
}

function DiscoverTable() {
  return (
    <div className="flex flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-2 pb-4">
        <ToolbarButton ariaLabel="Search"><MagnifyingGlass size={16} /></ToolbarButton>
        <ToolbarButton ariaLabel="Add"><PlusSmall size={16} /></ToolbarButton>
        <button type="button" className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Clear</button>
      </div>
      {/* header */}
      <div className="grid grid-cols-[1fr_140px_140px_32px] items-center px-2 pb-2 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>
        <span>Name</span><span>Status</span><span>Type</span><span />
      </div>
      {/* rows */}
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[1fr_140px_140px_32px] items-center border-t py-3" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
          <span className="flex items-center gap-2.5 min-w-0">
            <span style={{ color: "var(--fg-neutral-medium)" }}>
              {r.type === "Workflow" ? <Mcp size={16} /> : <TwoSquaresOverlapping size={16} />}
            </span>
            <span className="truncate text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{r.name}</span>
          </span>
          <span className="text-body-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Active</span>
          <span className="text-body-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{r.type}</span>
          <IconButton variant="tertiary" size="sm" aria-label="More"><ThreeDotsHorizontal size={16} /></IconButton>
        </div>
      ))}
    </div>
  );
}

function MyWorkflowsEmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-24 text-center">
      <TwoSquaresOverlapping size={32} color="var(--fg-neutral-prominent)" />
      <div className="flex flex-col gap-1">
        <h3 className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>No Workflows or Tools to show yet</h3>
        <p className="text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>Workflows &amp; Tools you add will appear here.</p>
      </div>
      <div className="mt-2">
        <Button variant="tertiary" size="md">Learn more</Button>
      </div>
    </div>
  );
}

export default function WorkflowsTools() {
  return (
    <Tabs.Root defaultValue="discover" className="flex flex-col gap-6">
      <div className="flex items-center justify-between" style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.List>
          <Tabs.Trigger value="discover">Discover</Tabs.Trigger>
          <Tabs.Trigger value="mine">My Workflows &amp; Tools</Tabs.Trigger>
        </Tabs.List>
        <button
          type="button"
          className="mb-2 flex items-center gap-1.5 rounded-square border px-2.5 py-1 text-body-small"
          style={{ borderColor: "var(--stroke-neutral-subtle)", color: "var(--fg-neutral-prominent)" }}
        >
          All <ChevronDownSmall size={14} />
        </button>
      </div>
      <Tabs.Content value="discover">
        <DiscoverTable />
      </Tabs.Content>
      <Tabs.Content value="mine">
        <MyWorkflowsEmptyState />
      </Tabs.Content>
    </Tabs.Root>
  );
}
