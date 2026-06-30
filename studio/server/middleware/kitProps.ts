// studio/server/middleware/kitProps.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { kitPropsFor } from "../codeWriter/kitProps";

export function kitPropsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "";
    if (req.method !== "GET" || !url.startsWith("/api/kit-props/")) return next?.();
    const component = decodeURIComponent(url.slice("/api/kit-props/".length).split("?")[0]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ props: kitPropsFor(component) }));
  };
}
