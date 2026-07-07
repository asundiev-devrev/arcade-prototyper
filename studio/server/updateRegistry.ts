/**
 * In-memory update blackboard. Electron main and the Vite server are separate
 * processes with no IPC, so the server holds the shared update state:
 *   - main POSTs the downloaded version here (setPending) and polls for an
 *     install request (getUpdateState().installRequested),
 *   - the shell GETs the pending version to prompt, and POSTs an install
 *     request (requestInstall) when the user clicks "Install & restart".
 * Same shape as turnRegistry: tiny, process-local, reset on server restart
 * (main re-POSTs on the next update-downloaded / periodic recheck).
 */
interface UpdateState {
  pendingVersion: string | null;
  installRequested: boolean;
}

const state: UpdateState = { pendingVersion: null, installRequested: false };

export function setPending(version: string): void {
  state.pendingVersion = version;
}

export function clearPending(): void {
  state.pendingVersion = null;
  state.installRequested = false;
}

export function requestInstall(): void {
  state.installRequested = true;
}

export function getUpdateState(): UpdateState {
  return { pendingVersion: state.pendingVersion, installRequested: state.installRequested };
}

/** Test-only: reset module state between tests. */
export function __resetForTest(): void {
  state.pendingVersion = null;
  state.installRequested = false;
}
