// studio/__tests__/server/expand/extractInstance.test.ts
import { describe, it, expect } from "vitest";
import { extractTopLevelInstance } from "../../../server/expand/extractInstance";

const SRC = `import { SettingsPage, NavSidebar, SettingsCard } from "arcade-prototypes";
export default function F() {
  return (
    <SettingsPage title="My Cards" subtitle="Manage" sidebar={<NavSidebar workspace="DevRev" />}>
      <SettingsCard title="Featured">cards</SettingsCard>
    </SettingsPage>
  );
}
`;

describe("extractTopLevelInstance", () => {
  it("extracts props + children source for the matching tag", () => {
    const r = extractTopLevelInstance(SRC, ["SettingsPage", "ComputerPage"]);
    expect(r).not.toBeNull();
    expect(r!.tag).toBe("SettingsPage");
    expect(r!.propsSrc.title).toBe(`"My Cards"`);
    expect(r!.propsSrc.subtitle).toBe(`"Manage"`);
    expect(r!.propsSrc.sidebar).toBe(`<NavSidebar workspace="DevRev" />`);
    expect(r!.childrenSrc).toContain(`<SettingsCard title="Featured">cards</SettingsCard>`);
    // span covers the whole element
    expect(SRC.slice(r!.start, r!.end)).toMatch(/^<SettingsPage[\s\S]*<\/SettingsPage>$/);
  });
  it("returns null when no tag matches", () => {
    expect(extractTopLevelInstance(`const x = <div/>;`, ["SettingsPage"])).toBeNull();
  });
  it("handles a self-closing instance (empty children)", () => {
    const r = extractTopLevelInstance(`const x = <ComputerPage state="empty" />;`, ["ComputerPage"]);
    expect(r!.tag).toBe("ComputerPage");
    expect(r!.propsSrc.state).toBe(`"empty"`);
    expect(r!.childrenSrc).toBe("");
  });
});
