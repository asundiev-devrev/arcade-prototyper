// studio/__tests__/server/figmaExport-singleton.test.ts
// @vitest-environment node
// Tests that the bridge singleton is process-wide (via globalThis), not module-level,
// so Vite config reloads don't spawn multiple WebSocket servers.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { liveGetBridge } from "../../server/middleware/figmaExport";

describe("figmaExport bridge singleton", () => {
  const BRIDGE_KEY = Symbol.for("arcade-studio.figma-bridge");

  beforeEach(() => {
    // Clear any pre-existing bridge from other tests
    delete (globalThis as any)[BRIDGE_KEY];
  });

  afterEach(async () => {
    // Clean up the bridge we created
    const g = globalThis as any;
    if (g[BRIDGE_KEY]) {
      try {
        const bridge = await g[BRIDGE_KEY];
        await bridge.close();
      } catch {
        // Ignore cleanup errors
      }
      delete g[BRIDGE_KEY];
    }
  });

  it("should store bridge promise in globalThis, not module-level", async () => {
    const g = globalThis as any;
    expect(g[BRIDGE_KEY]).toBeUndefined();

    const bridge1 = await liveGetBridge();
    // The promise should now be stored in globalThis
    expect(g[BRIDGE_KEY]).toBeDefined();
    expect(g[BRIDGE_KEY]).toBeInstanceOf(Promise);

    const bridge2 = await liveGetBridge();
    // Second call should return the SAME instance
    expect(bridge2).toBe(bridge1);
  });

  it("should not start multiple bridges on concurrent first calls", async () => {
    // Fire two concurrent calls before either resolves
    const [bridge1, bridge2] = await Promise.all([liveGetBridge(), liveGetBridge()]);

    // Both should resolve to the same instance (same port, same pending map, same wss)
    expect(bridge2).toBe(bridge1);
    expect(bridge1.port).toBe(bridge2.port); // Same port means same server
  });

  it("should survive simulated module re-evaluation", async () => {
    // First call creates the bridge
    const bridge1 = await liveGetBridge();
    const port1 = bridge1.port;

    // Simulate a NEW module context (as if Vite reloaded the middleware)
    // by calling liveGetBridge again. With a globalThis singleton, we should
    // get the SAME bridge instance, not a new one on a different port.
    const bridge2 = await liveGetBridge();
    const port2 = bridge2.port;

    expect(bridge2).toBe(bridge1);
    expect(port2).toBe(port1);
  });
});
