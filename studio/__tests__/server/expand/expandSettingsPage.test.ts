// studio/__tests__/server/expand/expandSettingsPage.test.ts
import { describe, it, expect } from "vitest";
import { expandSettingsPage } from "../../../prototype-kit/templates/SettingsPage";

describe("expandSettingsPage", () => {
  const props = {
    title: `"My Cards"`,
    subtitle: `"Manage your card collection"`,
    sidebar: `<NavSidebar workspace="DevRev" />`,
    children: `<SettingsCard title="Featured">cards</SettingsCard>`,
  };
  it("emits the flat AppShell+PageBody chrome with slots inlined", () => {
    const out = expandSettingsPage(props);
    // AppShell shell classes present (flattened, not <AppShell>)
    expect(out).toContain(`flex flex-col h-screen w-full bg-(--surface-backdrop) overflow-hidden`);
    expect(out).toContain(`<aside`);
    expect(out).toContain(`<main`);
    // PageBody body present with the title as a real <h1>
    expect(out).toContain(`mx-auto w-full max-w-[832px] px-6 pt-12 pb-16`);
    expect(out).toMatch(/<h1[^>]*text-title-large[^>]*>\s*My Cards\s*<\/h1>/);
    expect(out).toMatch(/<p[^>]*text-body[^>]*>\s*Manage your card collection\s*<\/p>/);
    // passed slots inlined verbatim
    expect(out).toContain(`<NavSidebar workspace="DevRev" />`);
    expect(out).toContain(`<SettingsCard title="Featured">cards</SettingsCard>`);
    // NOT a SettingsPage anymore
    expect(out).not.toContain(`<SettingsPage`);
  });
  it("omits the title block when no title/subtitle", () => {
    const out = expandSettingsPage({ sidebar: `<NavSidebar />`, children: `<div/>` });
    expect(out).not.toContain(`<h1`);
    expect(out).toContain(`<NavSidebar />`);
  });
  it("renders string-literal title without the surrounding quotes (as JSX text)", () => {
    const out = expandSettingsPage({ title: `"Hello"`, sidebar: `<X/>`, children: `<Y/>` });
    expect(out).toContain(`>Hello<`);     // text, not the quoted string
    expect(out).not.toContain(`>"Hello"<`);
  });
});
