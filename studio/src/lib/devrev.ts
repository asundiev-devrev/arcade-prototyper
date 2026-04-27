export interface DevRevPatStatus {
  configured: boolean;
  valid?: boolean;
  user?: { id: string; display_name: string };
}

export async function savePat(pat: string): Promise<DevRevPatStatus> {
  const res = await fetch("/api/settings/devrev-pat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pat }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Failed to save PAT");
  }
  return res.json();
}

export async function getPatStatus(): Promise<DevRevPatStatus> {
  const res = await fetch("/api/settings/devrev-pat/status");
  if (!res.ok) throw new Error("Failed to fetch PAT status");
  return res.json();
}

export async function clearPat(): Promise<void> {
  const res = await fetch("/api/settings/devrev-pat", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear PAT");
}
