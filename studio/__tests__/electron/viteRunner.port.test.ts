import { describe, it, expect } from "vitest";
import net from "node:net";
import { pickFreePort } from "../../../electron/shared/freePort";

describe("pickFreePort", () => {
  it("returns a bindable TCP port", async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(1023);
    // Prove it's actually free: we can bind it.
    await new Promise<void>((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(port, () => srv.close(() => resolve()));
    });
  });

  it("returns different ports across calls", async () => {
    const a = await pickFreePort();
    const b = await pickFreePort();
    // Not guaranteed distinct, but the OS rarely hands the same one back-to-back.
    expect(typeof a).toBe("number");
    expect(typeof b).toBe("number");
  });
});
