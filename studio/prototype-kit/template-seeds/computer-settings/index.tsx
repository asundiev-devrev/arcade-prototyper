import * as React from "react";
import { ComputerSettingsSidebar } from "./ComputerSettingsSidebar";
import { PAGE_TITLES, type PageId } from "./types.tsx";
import MyComputer from "./pages/MyComputer";
import Skills from "./pages/Skills";
import Connectors from "./pages/Connectors";
import Users from "./pages/Users";
import Profile from "./pages/Profile";
import Preferences from "./pages/Preferences";
import Organization from "./pages/Organization";

function PagePlaceholder({ id }: { id: PageId }) {
  return <div className="text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>{id} — coming soon</div>;
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
    default:
      return <PagePlaceholder id={id} />;
  }
}

export default function ComputerSettingsTemplate() {
  const [active, setActive] = React.useState<PageId>("my-computer");
  const meta = PAGE_TITLES[active] ?? PAGE_TITLES["my-computer"];
  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--surface-default)" }}>
      <ComputerSettingsSidebar active={active} onSelect={setActive} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex h-12 shrink-0 items-center px-9 text-body-small" style={{ color: "var(--fg-neutral-subtle)" }}>
          Settings <span className="px-1.5">›</span>
          <span style={{ color: "var(--fg-neutral-prominent)" }}>{meta.title}</span>
        </div>
        <div className="mx-auto w-full max-w-[760px] px-9 py-6">
          <h1 className="text-title-1" style={{ color: "var(--fg-neutral-prominent)" }}>{meta.title}</h1>
          <p className="mt-2 text-body-medium" style={{ color: "var(--fg-neutral-subtle)" }}>{meta.subtitle}</p>
          <div className="mt-8">{renderPage(active)}</div>
        </div>
      </div>
    </div>
  );
}
