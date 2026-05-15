import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { attachRelayToHttpServer, __resetWsServerForTests } from "../../server/relay/wsServer";
import { __resetProjectRegistryForTests, createOrGetProject, addCollaborator } from "../../server/relay/projectRegistry";

vi.mock("../../server/relay/auth", () => ({
  resolveDevuFromPat: async (pat: string) => {
    if (pat === "host-pat") return { id: "don:.../devu/1", displayName: "Andrey" };
    if (pat === "guest-pat") return { id: "don:.../devu/2", displayName: "Bea" };
    return null;
  },
}));

vi.mock("../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

let server: Server;
let port: number;

beforeEach(async () => {
  __resetWsServerForTests();
  __resetProjectRegistryForTests();
  server = createServer();
  attachRelayToHttpServer(server);
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function open(qs: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}/api/multiplayer/ws?${qs}`);
  await new Promise<void>((r, j) => {
    ws.once("open", () => r());
    ws.once("error", j);
  });
  return ws;
}

describe("multiplayer shared project — end to end", () => {
  it("frame_written from host reaches a connected guest", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    await addCollaborator(project.id, { devu: "don:.../devu/2", displayName: "Bea", addedBy: "don:.../devu/1" });
    const host = await open(`projectShareId=${project.id}&pat=host-pat&asRole=host`);
    const guest = await open(`projectShareId=${project.id}&pat=guest-pat&asRole=guest`);
    const guestEvents: any[] = [];
    guest.on("message", (raw) => guestEvents.push(JSON.parse(raw.toString())));
    await new Promise((r) => setTimeout(r, 50));
    host.send(JSON.stringify({ type: "frame_write", path: "frame-01", content: "<jsx>", turnId: "t1" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(guestEvents.find((e) => e.type === "frame_written")).toBeDefined();
    host.close();
    guest.close();
  });

  it("guest reconnect receives cache_replay with the latest frame state", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    await addCollaborator(project.id, { devu: "don:.../devu/2", displayName: "Bea", addedBy: "don:.../devu/1" });
    const host = await open(`projectShareId=${project.id}&pat=host-pat&asRole=host`);
    host.send(JSON.stringify({ type: "frame_write", path: "frame-01", content: "v1", turnId: "t1" }));
    await new Promise((r) => setTimeout(r, 50));

    // Guest joins for the first time AFTER the frame_write was sent.
    const guest = await open(`projectShareId=${project.id}&pat=guest-pat&asRole=guest`);
    const replay = await new Promise<any>((r) => {
      guest.on("message", (raw) => {
        const ev = JSON.parse(raw.toString());
        if (ev.type === "cache_replay") r(ev);
      });
    });
    expect(replay.frames["frame-01"]).toBe("v1");
    host.close();
    guest.close();
  });

  it("comment_posted from guest reaches the host", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    await addCollaborator(project.id, { devu: "don:.../devu/2", displayName: "Bea", addedBy: "don:.../devu/1" });
    const host = await open(`projectShareId=${project.id}&pat=host-pat&asRole=host`);
    const guest = await open(`projectShareId=${project.id}&pat=guest-pat&asRole=guest`);
    const hostEvents: any[] = [];
    host.on("message", (raw) => hostEvents.push(JSON.parse(raw.toString())));
    await new Promise((r) => setTimeout(r, 50));
    guest.send(JSON.stringify({ type: "comment_posted", id: "c1", text: "looks great", mentions: [] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(hostEvents.find((e) => e.type === "comment_posted" && e.text === "looks great")).toBeDefined();
    host.close();
    guest.close();
  });
});
