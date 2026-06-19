import * as React from "react";
import { Input, Avatar, Switch, Separator } from "arcade/components";

export default function Organization() {
  return (
    <div className="flex flex-col gap-8">
      {/* Organization picture */}
      <div className="flex items-center gap-4">
        <Avatar name="DevRev" size="lg" shape="square" />
        <div className="flex flex-col">
          <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Organization picture</span>
          <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Supported files: JPEG or PNG upto 10MB.</span>
        </div>
      </div>

      {/* Org fields: full-width Org Name, then Org url + Data location */}
      <div className="flex flex-col gap-4">
        <Input label="Org Name" defaultValue="DevRev" onChange={() => {}} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Org url" placeholder="http://....." onChange={() => {}} />
          <Input label="Data location" defaultValue="Singapore" onChange={() => {}} />
        </div>
      </div>

      <Separator />

      {/* Organization details */}
      <div className="flex flex-col gap-4">
        <h2 className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>Organization details</h2>
        <div className="flex flex-col gap-3 rounded-square-x2 border px-5 py-4" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Sign up permissions</span>
              <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Anyone with a devrev.ai email can join the org without an invite</span>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Enable websearch</span>
              <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Send search queries to the third-party providers for better results.</span>
            </div>
            <Switch defaultChecked />
          </div>
        </div>
      </div>

      <Separator />

      {/* Danger zone */}
      <div className="flex flex-col gap-4">
        <h2 className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>Danger zone</h2>
        <div className="flex items-center justify-between gap-4 rounded-square-x2 border px-5 py-4" style={{ borderColor: "var(--stroke-neutral-subtle)" }}>
          <div className="flex flex-col gap-0.5">
            <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Delete organization</span>
            <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>This will permanently delete the organization and its users.</span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-square px-3 py-1.5 text-system-medium"
            style={{ background: "var(--bg-alert-subtle)", color: "var(--fg-alert-prominent)" }}
          >
            Delete organization
          </button>
        </div>
      </div>
    </div>
  );
}
