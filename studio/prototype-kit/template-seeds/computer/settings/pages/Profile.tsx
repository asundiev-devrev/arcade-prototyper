import * as React from "react";
import { Input, Avatar, Separator } from "arcade/components";

export default function Profile() {
  return (
    <div className="flex flex-col gap-8">
      {/* Profile picture */}
      <div className="flex items-center gap-4">
        <Avatar name="Michael Machado" size="lg" shape="circle" />
        <div className="flex flex-col">
          <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Profile picture</span>
          <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Supported files: JPEG or PNG upto 10MB.</span>
        </div>
      </div>

      {/* Name + email fields: full-width Full name, then Display name + Email side by side */}
      <div className="flex flex-col gap-4">
        <Input label="Full name" defaultValue="Michael Machado" onChange={() => {}} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Display name" defaultValue="Michael" onChange={() => {}} />
          <Input label="Email" defaultValue="michael@maple.ai" onChange={() => {}} />
        </div>
      </div>

      <Separator />

      {/* Personalization */}
      <div className="flex flex-col gap-4">
        <h2 className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>Personalization</h2>
        <div
          className="flex items-center justify-between rounded-square-x2 border px-5 py-4"
          style={{ borderColor: "var(--stroke-neutral-subtle)" }}
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Your Role</span>
            <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>Let Computer search previous conversations for context</span>
          </div>
          <span className="text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>Head of Sales</span>
        </div>
      </div>

      <Separator />

      {/* Danger zone */}
      <div className="flex flex-col gap-4">
        <h2 className="text-title-3" style={{ color: "var(--fg-neutral-prominent)" }}>Danger zone</h2>
        <div
          className="flex items-center justify-between gap-4 rounded-square-x2 border px-5 py-4"
          style={{ borderColor: "var(--stroke-neutral-subtle)" }}
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-system-medium" style={{ color: "var(--fg-neutral-prominent)" }}>Leave organization</span>
            <span className="text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>
              Leave this organization and lose access to it? You'll still have access to any other organizations you belong to.
            </span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-square px-3 py-1.5 text-system-medium"
            style={{ background: "var(--bg-alert-subtle)", color: "var(--fg-alert-prominent)" }}
          >
            Leave organization
          </button>
        </div>
      </div>
    </div>
  );
}
