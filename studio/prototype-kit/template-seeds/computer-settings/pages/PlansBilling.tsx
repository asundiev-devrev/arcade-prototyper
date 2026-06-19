import * as React from "react";
import { SettingsCard, SettingsRow } from "arcade-prototypes";
import { Button, Tabs, Avatar, Clock, ChevronDownSmall, PlusSmall } from "arcade/components";

function Tile({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-square-x2 border p-4" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
      {children}
    </div>
  );
}

function TileHeader({ icon, label, action }: { icon?: React.ReactNode; label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>
        {icon}{label}
      </span>
      {action}
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

      {/* Plan summary */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>Computer Pro Plan</span>
          <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Trial ends April 15 · When your trial ends you'll be downgraded to Mini</span>
        </div>
        <Button variant="tertiary" size="sm">View plans</Button>
      </div>

      {/* KPI tiles */}
      <div className="flex gap-4">
        <Tile>
          <TileHeader
            icon={<Clock size={14} color="var(--fg-neutral-subtle)" />}
            label="Days remaining"
            action={<Button variant="primary" size="sm">Upgrade</Button>}
          />
          <span className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>3 days left</span>
          <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Book a demo with the team</span>
        </Tile>
        <Tile>
          <TileHeader label="Trial credits" />
          <span className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>3,200 / 4,000</span>
          <div className="mt-1 h-1.5 w-full rounded-full" style={{ background: "var(--bg-neutral-soft)" }}>
            <div className="h-1.5 rounded-full" style={{ width: "80%", background: "var(--fg-accent-prominent, #7c3aed)" }} />
          </div>
        </Tile>
        <Tile>
          <TileHeader
            label="Active users"
            action={<button type="button" className="text-body-small" style={{ color: "var(--fg-info-prominent, #2563eb)" }}>Invite</button>}
          />
          <span className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>12 users</span>
          <div className="flex items-center gap-1.5">
            <span className="flex -space-x-1.5">
              <Avatar name="Alice Ng" size="sm" />
              <Avatar name="Bob Ray" size="sm" />
              <Avatar name="Cara Lee" size="sm" />
            </span>
            <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>9+</span>
          </div>
        </Tile>
      </div>

      {/* View all plan inclusions */}
      <button
        type="button"
        className="flex items-center justify-between rounded-square px-1 py-1 text-system-medium"
        style={{ color: "var(--fg-neutral-prominent)" }}
      >
        View all plan inclusions
        <ChevronDownSmall size={16} color="var(--fg-neutral-subtle)" />
      </button>

      <hr style={{ border: "none", borderTop: "1px solid var(--stroke-neutral-subtle)" }} />

      {/* Billing details */}
      <SettingsCard title="Billing details">
        <SettingsRow label="Payment details" description="Reminders, notifications and emails are delivered based on your time zone."
          action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Add payment method</Button>} />
        <SettingsRow label="Billing information" description="Review or update your Organizations billing information"
          action={<Button variant="tertiary" size="sm" iconLeft={<PlusSmall size={16} />}>Add billing address</Button>} />
        <SettingsRow label="Billing admins" description="Add and remove people who can manage your Computer account."
          action={<span className="text-body-small" style={{ color: "var(--fg-neutral-medium)" }}>Manage admins</span>} />
      </SettingsCard>
    </div>
  );
}
