import net from "node:net";

/**
 * Asks the OS for a free TCP port by binding :0, reading the assigned port,
 * then closing. There's an inherent TOCTOU window (the port could be taken
 * between close and re-bind), so callers MUST still spawn with strictPort and
 * treat a bind failure as retryable.
 */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not determine free port")));
      }
    });
  });
}
