import fs from "node:fs/promises";
import path from "node:path";
import { studioRoot } from "../paths";

// Reads the Cloudflare share key from settings.json. The same key authorizes
// /share deploys (see cloudflare/deploy.ts) and the rendezvous publish/fetch
// routes (see cloudflare/rendezvous.ts). Returns null if settings or the
// key are missing.
export async function getShareKey(): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(studioRoot(), "settings.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const key = String(parsed?.cloudflare?.shareKey ?? "").trim();
    return key || null;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}
