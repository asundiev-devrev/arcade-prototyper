/**
 * Figma desktop exposes CDP on localhost:9222, and figma-use (the
 * binary figma-cli shells out to) always picks the first tab whose URL
 * contains `figma.com/design`. When the user has multiple Figma files
 * open, that's usually the wrong one — node IDs from one file don't
 * exist in another, and figma-use reports a confusing CDP timeout.
 *
 * This helper extracts the file key from a Figma URL in the prompt and
 * closes any other /design tabs so figma-use falls through to the one
 * the user actually asked about.
 */

const CDP_ROOT = "http://localhost:9222";

type CdpTab = { id: string; type: string; url: string; title: string };

function extractFigmaFileKey(text: string): string | null {
  const match = text.match(/figma\.com\/design\/([A-Za-z0-9]+)/);
  return match?.[1] ?? null;
}

async function listTabs(): Promise<CdpTab[]> {
  try {
    const res = await fetch(`${CDP_ROOT}/json`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    return (await res.json()) as CdpTab[];
  } catch {
    return [];
  }
}

async function closeTab(id: string): Promise<void> {
  try {
    await fetch(`${CDP_ROOT}/json/close/${id}`, { signal: AbortSignal.timeout(2000) });
  } catch {}
}

/**
 * If the prompt references a Figma file, make sure that file's tab is
 * the only `figma.com/design` page visible over CDP. Non-design tabs
 * (home, settings, board) and unrelated blobs are left alone.
 *
 * Best-effort: all network errors are swallowed. A missing or
 * unreachable Figma is surfaced to the agent naturally when figma-cli
 * next fails.
 */
export async function ensureFigmaFileSelected(prompt: string): Promise<{
  action: "none" | "already-first" | "closed-others" | "file-not-open";
  fileKey: string | null;
  closed: string[];
}> {
  const fileKey = extractFigmaFileKey(prompt);
  if (!fileKey) return { action: "none", fileKey: null, closed: [] };

  const tabs = await listTabs();
  const designTabs = tabs.filter(
    (t) => t.type === "page" && typeof t.url === "string" && t.url.includes("figma.com/design"),
  );
  if (designTabs.length === 0) return { action: "file-not-open", fileKey, closed: [] };

  const targetTabs = designTabs.filter((t) => t.url.includes(`/design/${fileKey}`));
  if (targetTabs.length === 0) return { action: "file-not-open", fileKey, closed: [] };

  const toClose = designTabs.filter((t) => !t.url.includes(`/design/${fileKey}`));
  if (toClose.length === 0) return { action: "already-first", fileKey, closed: [] };

  for (const t of toClose) await closeTab(t.id);
  return { action: "closed-others", fileKey, closed: toClose.map((t) => t.title) };
}
