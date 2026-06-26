import { describe, it, expect, vi, beforeEach } from "vitest";

const readFile = vi.fn();
const writeFile = vi.fn();
vi.mock("node:fs/promises", () => ({ default: { readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }, readFile: (...a: unknown[]) => readFile(...a), writeFile: (...a: unknown[]) => writeFile(...a) }));
vi.mock("../../../server/paths", () => ({ frameDir: (p: string, f: string) => `/root/projects/${p}/frames/${f}` }));
const aiExpandFrame = vi.fn().mockResolvedValue({ ok: true });
vi.mock("../../../server/expand/aiExpand", () => ({ aiExpandFrame: (...a: unknown[]) => aiExpandFrame(...a) }));

import { expandChangedFrames } from "../../../server/expand/postGenHook";

const SETTINGS = `import { SettingsPage, NavSidebar } from "arcade-prototypes";
export default () => <SettingsPage title="X" sidebar={<NavSidebar/>}>body</SettingsPage>;
`;

describe("expandChangedFrames", () => {
  beforeEach(() => { readFile.mockReset(); writeFile.mockReset(); aiExpandFrame.mockClear(); });
  it("writes the flat source for an authored composite frame", async () => {
    readFile.mockResolvedValue(SETTINGS);
    await expandChangedFrames("demo", ["01-page"]);
    expect(writeFile).toHaveBeenCalled();
    const written = writeFile.mock.calls[0][1] as string;
    expect(written).not.toContain("<SettingsPage");
    expect(written).toContain("max-w-[832px]");
    expect(aiExpandFrame).not.toHaveBeenCalled();
  });
  it("routes an un-authored composite to AI fallback, no direct write", async () => {
    readFile.mockResolvedValue(`import { VistaPage } from "arcade-prototypes";\nexport default () => <VistaPage title="x">b</VistaPage>;`);
    await expandChangedFrames("demo", ["01-v"]);
    expect(aiExpandFrame).toHaveBeenCalledWith("demo", "01-v", "VistaPage");
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("no-op for a frame with no full-page composite", async () => {
    readFile.mockResolvedValue(`export default () => <div/>;`);
    await expandChangedFrames("demo", ["01-flat"]);
    expect(writeFile).not.toHaveBeenCalled();
    expect(aiExpandFrame).not.toHaveBeenCalled();
  });
  it("swallows a read error (never throws)", async () => {
    readFile.mockRejectedValue(new Error("nope"));
    await expect(expandChangedFrames("demo", ["01-x"])).resolves.toBeUndefined();
  });
});
