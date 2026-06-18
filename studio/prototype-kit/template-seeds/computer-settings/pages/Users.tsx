import * as React from "react";
import { Button, Avatar, Tag, IconButton, ThreeDotsHorizontal, Tabs } from "arcade/components";

const users = [
  { name: "Michael Machado", email: "michael@maple.ai", role: "Admin" },
  { name: "Anmol Agarwal", email: "anmol@maple.ai", role: "Member" },
  { name: "Tim Diacon", email: "tim@maple.ai", role: "Member" },
  { name: "Shubham Gandhi", email: "shubham@maple.ai", role: "Member" },
  { name: "Priya Nair", email: "priya@maple.ai", role: "Member" },
  { name: "Diego Alvarez", email: "diego@maple.ai", role: "Member" },
];

export default function Users() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Tabs.Root defaultValue="users">
          <Tabs.List>
            <Tabs.Trigger value="users">Users 234</Tabs.Trigger>
            <Tabs.Trigger value="invitations">Invitations 4</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
        <Button variant="primary" size="sm">Invite users</Button>
      </div>
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
            <span className="flex items-center gap-3">
              <span className="text-body-small" style={{ color: "var(--fg-neutral-medium)" }}>{u.role}</span>
              <IconButton variant="tertiary" size="sm" aria-label="More"><ThreeDotsHorizontal size={16} /></IconButton>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
