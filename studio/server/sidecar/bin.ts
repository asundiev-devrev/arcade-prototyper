import { createSidecarServer } from "./arcadeSidecar";

const portArg = process.argv.indexOf("--port");
const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 7799;

const server = createSidecarServer();
server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[arcade-sidecar] listening on http://127.0.0.1:${port}`);
});
