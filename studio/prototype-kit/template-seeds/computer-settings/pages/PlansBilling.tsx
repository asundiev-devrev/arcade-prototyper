import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Button, Tabs, PlusSmall } from "arcade/components";

function MetricTile({ label, value, action, bar }: { label: string; value: string; action?: React.ReactNode; bar?: number }) {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-square-x2 border p-4" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
      <div className="flex items-center justify-between">
        <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{label}</span>
        {action}
      </div>
      <span className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>{value}</span>
      {bar != null && (
        <div className="h-1.5 w-full rounded-full" style={{ background: "var(--bg-neutral-soft)" }}>
          <div className="h-1.5 rounded-full" style={{ width: `${bar}%`, background: "var(--fg-accent-prominent, #7c3aed)" }} />
        </div>
      )}
    </div>
  );
}

export default function PlansBilling() {
  return (
    <div className="flex flex-col gap-6">
      <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.Root defaultValue="billing">
          <Tabs.List>
            <Tabs.Trigger value="billing">Billing</Tabs.Trigger>
            <Tabs.Trigger value="usage">Usage</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>Computer Pro Plan</span>
          <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Trial ends April 15 · When your trial ends you'll be downgraded to Mini</span>
        </div>
        <Button variant="tertiary" size="sm">View plans</Button>
      </div>
      <div className="flex gap-4">
        <MetricTile label="Days remaining" value="3 days left" action={<Button variant="primary" size="sm">Upgrade</Button>} />
        <MetricTile label="Trial credits" value="3,200 / 4,000" bar={80} />
        <MetricTile label="Active users" value="12 users" action={<Button variant="tertiary" size="sm">Invite</Button>} />
      </div>
      <SettingsCard title="Billing details">
        <SettingsRow label="Payment details" description="Reminders, notifications and emails are delivered based on your time zone."
          action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Add payment method</Button>} />
        <SettingsRow label="Billing information" description="Review or update your organization's billing information."
          action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Add billing address</Button>} />
        <SettingsRow label="Billing admins" description="Add and remove people who can manage your Computer account."
          action={<span className="text-body-small" style={{ color: "var(--fg-neutral-medium)" }}>Manage admins</span>} />
      </SettingsCard>
    </div>
  );
}
