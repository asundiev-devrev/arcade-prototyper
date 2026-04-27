import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { studioRoot } from "../paths";
import {
  saveDevRevPat,
  getDevRevPat,
  deleteDevRevPat,
  validatePat,
} from "../secrets/keychain";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  return buf ? JSON.parse(buf) : {};
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

const SETTINGS_FILE = "settings.json";

interface GlobalSettings {
  vercel?: {
    token?: string;
    teamId?: string;
    projectName?: string;
  };
  devrev?: {
    user?: { id: string; display_name: string };
  };
  studio?: {
    mode?: "light" | "dark";
  };
  [key: string]: unknown;
}

async function readSettings(): Promise<GlobalSettings> {
  const file = path.join(studioRoot(), SETTINGS_FILE);
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch (err: any) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeSettings(settings: GlobalSettings): Promise<void> {
  const file = path.join(studioRoot(), SETTINGS_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(settings, null, 2));
}

export function settingsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";

    try {
      // DevRev PAT status
      if (url === "/api/settings/devrev-pat/status" && req.method === "GET") {
        const settings = await readSettings();
        const pat = await getDevRevPat();
        if (!pat) return send(res, 200, { configured: false });
        const user = await validatePat(pat);
        return send(res, 200, {
          configured: true,
          valid: !!user,
          user: user ?? settings.devrev?.user,
        });
      }

      // DevRev PAT save
      if (url === "/api/settings/devrev-pat" && req.method === "POST") {
        const body = await readJson(req);
        const pat = body?.pat;
        if (typeof pat !== "string" || !pat.trim()) {
          return send(res, 400, { error: { code: "bad_request", message: "pat field required" } });
        }
        const user = await validatePat(pat);
        if (!user) {
          return send(res, 401, { error: { code: "invalid_pat", message: "Invalid PAT" } });
        }
        await saveDevRevPat(pat.trim());
        const settings = await readSettings();
        await writeSettings({
          ...settings,
          devrev: { ...(settings.devrev ?? {}), user },
        });
        return send(res, 200, { configured: true, valid: true, user });
      }

      // DevRev PAT remove
      if (url === "/api/settings/devrev-pat" && req.method === "DELETE") {
        await deleteDevRevPat();
        const settings = await readSettings();
        if (settings.devrev) {
          const { user: _discard, ...rest } = settings.devrev;
          void _discard;
          const next = { ...settings, devrev: Object.keys(rest).length ? rest : undefined };
          if (!next.devrev) delete next.devrev;
          await writeSettings(next);
        }
        return send(res, 200, { configured: false });
      }

      if (url !== "/api/settings") return next?.();

      if (req.method === "GET") {
        return send(res, 200, await readSettings());
      }
      if (req.method === "PATCH") {
        const body = await readJson(req);
        const current = await readSettings();
        const next = { ...current, ...body };
        await writeSettings(next);
        return send(res, 200, next);
      }
      send(res, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } });
    } catch (err: any) {
      send(res, 400, { error: { code: "bad_request", message: err.message } });
    }
  };
}
