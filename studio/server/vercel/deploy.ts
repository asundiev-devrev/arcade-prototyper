function redactToken(text: string, token: string): string {
  if (!text) return text;
  let out = text;
  if (token && token.length >= 4) out = out.split(token).join("[REDACTED]");
  return out.replace(/\b[A-Za-z0-9]{20,}\b/g, (match) =>
    match === "REDACTED" ? match : "[REDACTED]",
  );
}

interface DeploymentFile {
  file: string;
  data: string;
}

interface DeploymentResult {
  id: string;
  url: string;
  readyState: "READY" | "ERROR" | "QUEUED" | "BUILDING";
}

export async function deployToVercel({
  name,
  files,
  token,
  teamId,
}: {
  name: string;
  files: DeploymentFile[];
  token: string;
  teamId?: string;
}): Promise<DeploymentResult> {
  const url = teamId
    ? `https://api.vercel.com/v13/deployments?teamId=${teamId}`
    : "https://api.vercel.com/v13/deployments";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      files,
      projectSettings: { framework: null },
      target: "production",
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    const sanitized = redactToken(raw, token);
    throw new Error(`Vercel deploy failed: ${response.status} ${sanitized}`);
  }

  const result = await response.json();
  return {
    id: result.id,
    url: result.url,
    readyState: result.readyState || "QUEUED",
  };
}

export async function validateVercelToken(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.vercel.com/v2/user", {
      headers: { "Authorization": `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
