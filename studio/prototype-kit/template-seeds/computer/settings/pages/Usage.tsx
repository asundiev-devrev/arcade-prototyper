import * as React from "react";
import { Tabs, IconButton, InfoInCircle, ThreeDotsHorizontal, PlusSmall } from "arcade/components";

function CreditCard({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="flex flex-1 flex-col gap-3 rounded-square-x2 border p-5" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
      <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{label}</span>
      <span className="text-title-2" style={{ color: "var(--fg-neutral-prominent)" }}>{value}</span>
      <div className="h-1.5 w-full rounded-full" style={{ background: "var(--bg-neutral-soft)" }}>
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: "var(--fg-accent-prominent, #7c3aed)" }} />
      </div>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-square-x2 border p-5" style={{ borderColor: "var(--stroke-neutral-subtle)", minHeight: 132 }}>
      <div className="flex items-start justify-between">
        <span className="flex items-center gap-1.5 text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>
          {title} <InfoInCircle size={14} color="var(--fg-neutral-subtle)" />
        </span>
        <IconButton variant="tertiary" size="sm" aria-label="More"><ThreeDotsHorizontal size={16} /></IconButton>
      </div>
      <span className="text-title-1" style={{ color: "var(--fg-neutral-prominent)" }}>{value}</span>
    </div>
  );
}

const metrics = [
  { title: "Computer Credits", value: "112" },
  { title: "Computer Sessions Count", value: "149" },
  { title: "Computer Answers Count", value: "112" },
  { title: "Computer Actions Count", value: "149" },
];

export default function Usage() {
  return (
    <Tabs.Root defaultValue="overview" className="flex flex-col gap-6">
      <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.List>
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="logs">Session logs</Tabs.Trigger>
        </Tabs.List>
      </div>

      <Tabs.Content value="overview" className="flex flex-col gap-8">
        {/* Usage overview */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>Usage overview</h2>
            <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Current billing period · Apr 1 – Apr 30, 2026</span>
          </div>
          <div className="flex gap-4">
            <CreditCard label="Plan Credits" value="3,200 / 4,000" pct={80} />
            <CreditCard label="Mycredits" value="3,200 / 4,000" pct={80} />
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--stroke-neutral-subtle)" }} />

        {/* Session Analytics */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>Session Analytics</h2>
            <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Filter your data to view how your team is using computer</span>
          </div>

          {/* Filter toolbar */}
          <div className="flex items-center gap-2">
            <span className="flex items-center overflow-hidden rounded-square border text-body-small" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
              <span className="px-2 py-1" style={{ color: "var(--fg-neutral-subtle)" }}>User ID</span>
              <span className="px-2 py-1" style={{ borderLeft: "1px solid var(--stroke-neutral-subtle)", color: "var(--fg-neutral-subtle)" }}>Any of</span>
              <span className="px-2 py-1" style={{ borderLeft: "1px solid var(--stroke-neutral-subtle)", color: "var(--fg-neutral-prominent)" }}>Add</span>
            </span>
            <span className="flex items-center overflow-hidden rounded-square border text-body-small" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
              <span className="px-2 py-1" style={{ color: "var(--fg-neutral-subtle)" }}>Session Start Time</span>
              <span className="px-2 py-1" style={{ borderLeft: "1px solid var(--stroke-neutral-subtle)", color: "var(--fg-neutral-prominent)" }}>Last 30 days</span>
            </span>
            <IconButton variant="tertiary" size="sm" aria-label="Add filter"><PlusSmall size={16} /></IconButton>
            <button type="button" className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Clear</button>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {metrics.map((m) => (<MetricCard key={m.title} title={m.title} value={m.value} />))}
          </div>
        </div>
      </Tabs.Content>

      <Tabs.Content value="logs">
        <div className="px-6 py-16 text-center text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>
          Session logs will appear here.
        </div>
      </Tabs.Content>
    </Tabs.Root>
  );
}
