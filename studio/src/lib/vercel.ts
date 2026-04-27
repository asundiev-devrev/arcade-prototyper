export async function deployFrame(projectSlug: string, frameSlug: string): Promise<string> {
  const res = await fetch(`/api/projects/${projectSlug}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frameSlug }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message || "Deploy failed");
  }

  const data = await res.json();
  return data.url;
}

export async function getDeployments(projectSlug: string): Promise<Array<{
  frameSlug: string;
  url: string;
  createdAt: string;
}>> {
  const res = await fetch(`/api/projects/${projectSlug}`);
  if (!res.ok) throw new Error("Failed to fetch project");

  const project = await res.json();
  return project.deployments || [];
}
