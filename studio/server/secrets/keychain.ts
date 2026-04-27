import fs from "node:fs/promises";
import path from "node:path";
import { studioRoot } from "../paths";

/**
 * Global (app-level) storage for the DevRev PAT.
 * Keychain via keytar (macOS) with a plaintext fallback file in the studio root.
 */

const SERVICE = "arcade-studio";
const ACCOUNT = "devrev-pat";

let keytar: typeof import("keytar") | null = null;
let keytarAvailable = false;

try {
  keytar = await import("keytar");
  keytarAvailable = true;
} catch {
  console.warn("[secrets] keytar not available, falling back to plaintext storage");
}

function plaintextPath(): string {
  return path.join(studioRoot(), ".secrets.json");
}

export async function saveDevRevPat(pat: string): Promise<void> {
  if (keytarAvailable && keytar) {
    try {
      await keytar.setPassword(SERVICE, ACCOUNT, pat);
      return;
    } catch (err) {
      console.warn("[secrets] keytar save failed, falling back to plaintext:", err);
    }
  }

  const file = plaintextPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    // ignore
  }
  await fs.writeFile(file, JSON.stringify({ ...existing, devrevPat: pat }, null, 2));
}

export async function getDevRevPat(): Promise<string | null> {
  if (keytarAvailable && keytar) {
    try {
      const pat = await keytar.getPassword(SERVICE, ACCOUNT);
      if (pat) return pat;
    } catch (err) {
      console.warn("[secrets] keytar read failed, trying fallback:", err);
    }
  }
  try {
    const raw = await fs.readFile(plaintextPath(), "utf-8");
    const parsed = JSON.parse(raw) as { devrevPat?: string };
    return parsed.devrevPat ?? null;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function deleteDevRevPat(): Promise<void> {
  if (keytarAvailable && keytar) {
    try {
      await keytar.deletePassword(SERVICE, ACCOUNT);
    } catch {
      // ignore
    }
  }
  try {
    const raw = await fs.readFile(plaintextPath(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    delete parsed.devrevPat;
    if (Object.keys(parsed).length === 0) {
      await fs.unlink(plaintextPath());
    } else {
      await fs.writeFile(plaintextPath(), JSON.stringify(parsed, null, 2));
    }
  } catch {
    // ignore
  }
}

export async function validatePat(
  pat: string,
): Promise<{ id: string; display_name: string } | null> {
  try {
    const res = await fetch("https://api.devrev.ai/dev-users.self", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: pat },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      dev_user?: { id?: string; display_name?: string };
    };
    if (data.dev_user?.id && data.dev_user?.display_name) {
      return { id: data.dev_user.id, display_name: data.dev_user.display_name };
    }
    return null;
  } catch {
    return null;
  }
}
