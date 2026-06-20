import * as React from "react";
import { Button, PlusSmall } from "arcade/components";
import { ComputerSettingsSidebar } from "./ComputerSettingsSidebar";
import { PAGE_TITLES, type PageId } from "./types.tsx";
import MyComputer from "./pages/MyComputer";
import Skills from "./pages/Skills";
import Connectors from "./pages/Connectors";
import Users from "./pages/Users";
import Profile from "./pages/Profile";
import Preferences from "./pages/Preferences";
import Organization from "./pages/Organization";
import WorkflowsTools from "./pages/WorkflowsTools";
import PlansBilling from "./pages/PlansBilling";
import Usage from "./pages/Usage";

function PagePlaceholder({ id }: { id: PageId }) {
  return <div className="text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>{id} — coming soon</div>;
}

// Primary action rendered inline with the page <h1>, right-aligned. Keyed by
// page so a page that has a header CTA (e.g. Skills) gets it next to the title.
function headerAction(id: PageId): React.ReactNode {
  switch (id) {
    case "skills":
      return <Button variant="primary" size="sm" iconLeft={<PlusSmall size={16} />}>Add skills</Button>;
    case "users":
      return <Button variant="primary" size="sm">Invite users</Button>;
    case "connectors":
      return <Button variant="primary" size="sm">Add custom connector</Button>;
    default:
      return null;
  }
}

function renderPage(id: PageId): React.ReactNode {
  switch (id) {
    case "my-computer": return <MyComputer />;
    case "skills": return <Skills />;
    case "connectors": return <Connectors />;
    case "users": return <Users />;
    case "profile": return <Profile />;
    case "preferences": return <Preferences />;
    case "organization": return <Organization />;
    case "workflows-tools": return <WorkflowsTools />;
    case "plans-billing": return <PlansBilling />;
    case "usage": return <Usage />;
    default:
      return <PagePlaceholder id={id} />;
  }
}

// `onBack` — when provided (e.g. by the chat seed that swaps chat ↔ settings),
// the sidebar's back row becomes a button that returns to the chat view.
export default function ComputerSettingsTemplate({ onBack }: { onBack?: () => void } = {}) {
  const [active, setActive] = React.useState<PageId>("my-computer");
  const meta = PAGE_TITLES[active] ?? PAGE_TITLES["my-computer"];
  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--surface-default)" }}>
      <ComputerSettingsSidebar active={active} onSelect={setActive} onBack={onBack} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex h-12 shrink-0 items-center px-9 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>
          Settings <span className="px-1.5">›</span>
          <span style={{ color: "var(--fg-neutral-prominent)" }}>{meta.title}</span>
        </div>
        <div className="mx-auto w-full max-w-[760px] px-9 py-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-title-1" style={{ color: "var(--fg-neutral-prominent)" }}>{meta.title}</h1>
            {headerAction(active)}
          </div>
          <p className="mt-2 text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>{meta.subtitle}</p>
          <div className="mt-8">{renderPage(active)}</div>
        </div>
      </div>
    </div>
  );
}
