import * as React from "react";
import { Avatar, IconButton, ThreeDotsHorizontal, MagnifyingGlass, PlusSmall, InfoInCircle, Tabs } from "arcade/components";

const users = [
  { name: "Michael Machado", email: "michael@maple.ai", role: "Admin" },
  { name: "Anmol Agarwal", email: "anmol@maple.ai", role: "Member" },
  { name: "Tim Diacon", email: "tim@maple.ai", role: "Member" },
  { name: "Shubham Gandhi", email: "shubham@maple.ai", role: "Member" },
  { name: "Priya Nair", email: "priya@maple.ai", role: "Member" },
  { name: "Diego Alvarez", email: "diego@maple.ai", role: "Member" },
  { name: "Eve Larsen", email: "eve@maple.ai", role: "Member" },
  { name: "Carla Diaz", email: "carla@maple.ai", role: "Member" },
];

export default function Users() {
  return (
    <div className="flex flex-col gap-5">
      <div style={{ borderBottom: "1px solid var(--stroke-neutral-subtle)" }}>
        <Tabs.Root defaultValue="users">
          <Tabs.List>
            <Tabs.Trigger value="users">Users 234</Tabs.Trigger>
            <Tabs.Trigger value="invitations">Invitations 4</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-2">
        <IconButton variant="tertiary" size="sm" aria-label="Search"><MagnifyingGlass size={16} /></IconButton>
        <span
          className="flex items-center overflow-hidden rounded-square border text-body-small"
          style={{ borderColor: "var(--stroke-neutral-subtle)" }}
        >
          <span className="px-2 py-1" style={{ color: "var(--fg-neutral-subtle)" }}>User state</span>
          <span className="px-2 py-1" style={{ borderLeft: "1px solid var(--stroke-neutral-subtle)", color: "var(--fg-neutral-prominent)" }}>Active</span>
        </span>
        <IconButton variant="tertiary" size="sm" aria-label="Add filter"><PlusSmall size={16} /></IconButton>
        <button type="button" className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Clear All</button>
      </div>

      {/* Table */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-2 pb-2 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>
          <span>Name</span><span>Role</span>
        </div>
        {users.map((u) => (
          <div key={u.email} className="flex items-center justify-between border-t py-3" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
            <span className="flex items-center gap-3">
              <Avatar name={u.name} size="sm" />
              <span className="flex flex-col">
                <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{u.name}</span>
                <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>{u.email}</span>
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-body-medium" style={{ color: "var(--fg-neutral-prominent)" }}>{u.role}</span>
              <InfoInCircle size={14} color="var(--fg-neutral-subtle)" />
              <IconButton variant="tertiary" size="sm" aria-label="More"><ThreeDotsHorizontal size={16} /></IconButton>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
