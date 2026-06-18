import * as React from "react";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-square-x2 border p-4" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
      <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{label}</span>
      <span className="text-title-2" style={{ color: "var(--fg-neutral-prominent)" }}>{value}</span>
    </div>
  );
}

const usageByDay = [
  { day: "Mon", pct: 40 }, { day: "Tue", pct: 65 }, { day: "Wed", pct: 52 },
  { day: "Thu", pct: 80 }, { day: "Fri", pct: 70 }, { day: "Sat", pct: 24 }, { day: "Sun", pct: 18 },
];

export default function Usage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-4">
        <Kpi label="Messages this month" value="48,210" />
        <Kpi label="Active users" value="12" />
        <Kpi label="Credits used" value="3,200 / 4,000" />
      </div>
      <div className="rounded-square-x2 border p-5" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
        <div className="mb-4 text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Usage this week</div>
        <div className="flex items-end gap-3" style={{ height: 160 }}>
          {usageByDay.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
              <div className="w-full rounded-square" style={{ height: `${d.pct}%`, background: "var(--fg-accent-prominent, #7c3aed)" }} />
              <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{d.day}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
