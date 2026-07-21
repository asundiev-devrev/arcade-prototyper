import { describe, it, expect } from "vitest";
import path from "node:path";
import { handleProjectWatchEvent } from "../../../server/plugins/projectWatchPlugin";
import { projectsRoot } from "../../../server/paths";

function fakeServer() {
  const sent: any[] = [];
  return {
    sent,
    ws: { send: (m: any) => sent.push(m) },
    moduleGraph: { getModulesByFile: () => new Set(), invalidateModule: () => {} },
  };
}
const frameFile = (slug: string, frameId: string, file: string) =>
  path.join(projectsRoot(), slug, "frames", frameId, file);

describe("projectWatchPlugin frame-source write", () => {
  it("sends a targeted frame-changed custom event (not full-reload)", async () => {
    const server = fakeServer();
    await handleProjectWatchEvent("add", frameFile("proj", "01-frame", "index.tsx"), server as any);
    expect(server.sent.filter((m) => m.type === "full-reload")).toEqual([]);
    const targeted = server.sent.filter((m) => m.type === "custom" && m.event === "arcade-studio:frame-changed");
    expect(targeted).toHaveLength(1);
    expect(targeted[0].data).toEqual({ slug: "proj", frameId: "01-frame" });
  });

  it("sends frame-changed for a NESTED code module (pages/Skills.tsx), targeting the right frameId", async () => {
    const server = fakeServer();
    await handleProjectWatchEvent("change", frameFile("proj", "01-frame", "pages/Skills.tsx"), server as any);
    const targeted = server.sent.filter((m) => m.type === "custom" && m.event === "arcade-studio:frame-changed");
    expect(targeted).toHaveLength(1);
    // frameId must still be the frame dir (parts[2]), not the nested segment.
    expect(targeted[0].data).toEqual({ slug: "proj", frameId: "01-frame" });
  });

  it("does NOT send for a non-frame-source write (theme-overrides.css)", async () => {
    const server = fakeServer();
    await handleProjectWatchEvent("change", path.join(projectsRoot(), "proj", "theme-overrides.css"), server as any);
    expect(server.sent.filter((m) => m.type === "custom" || m.type === "full-reload")).toEqual([]);
  });

  it("does NOT send for a nested ASSET write (frames/<id>/assets/icon.svg)", async () => {
    const server = fakeServer();
    await handleProjectWatchEvent("change", frameFile("proj", "01-frame", "assets/icon.svg"), server as any);
    expect(server.sent.filter((m) => m.type === "custom" || m.type === "full-reload")).toEqual([]);
  });
});
