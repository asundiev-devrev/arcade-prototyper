/**
 * Pure logic for the "Update available" prompt. The shell polls
 * /api/update/status; this decides whether to show the prompt given what the
 * user has dismissed. "Later" dismisses the CURRENT pending version only, so a
 * subsequent, newer release prompts again.
 */
export interface UpdateStatus {
  pendingVersion: string | null;
  installRequested: boolean;
}

export function shouldPrompt(
  status: UpdateStatus | null,
  dismissedVersion: string | null,
): boolean {
  if (!status || !status.pendingVersion) return false;
  return status.pendingVersion !== dismissedVersion;
}
