import { useEffect, useState } from "react";
import { Modal, Button } from "@xorkavi/arcade-gen";
import { shouldPrompt, type UpdateStatus } from "../../lib/updateNotice";
import { track } from "../../lib/telemetry/renderer";

/**
 * Notify-first update prompt. Electron main downloads an update in the
 * background and publishes it to the server blackboard (/api/update/status).
 * We poll that; when a new version is pending and not yet dismissed, we ask the
 * tester. "Install & restart" POSTs /api/update/install — main sees it, applies
 * when idle, and relaunches. "Later" dismisses just this version (persisted, so
 * a reload doesn't re-nag; a NEWER version still prompts).
 *
 * Mounted once at the app root. No auto-restart ever happens without the click.
 */
const POLL_MS = 15_000;
/** If the install doesn't relaunch the app within this window, quitAndInstall
 *  likely couldn't swap the bundle. Re-enable the UI + reset server state so the
 *  tester isn't stuck behind a frozen "Updating…" (Finding 6 — no auto-rollback,
 *  so degrade gracefully). */
const INSTALL_TIMEOUT_MS = 60_000;
/** Persist dismissal so a shell reload doesn't re-prompt the same version. */
const DISMISSED_KEY = "arcade-studio:update-dismissed";

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(
    () => window.localStorage.getItem(DISMISSED_KEY),
  );
  const [installing, setInstalling] = useState(false);
  const [installStalled, setInstallStalled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/update/status");
        if (!res.ok) return;
        const body = (await res.json()) as UpdateStatus;
        if (!cancelled) setStatus(body);
      } catch {
        /* server momentarily unavailable — try next tick */
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const open = !installing && shouldPrompt(status, dismissed);
  const version = status?.pendingVersion ?? "";

  // Telemetry: fire once when the prompt first becomes visible for a version.
  useEffect(() => {
    if (open && version) track({ name: "update_offered", props: { version } });
  }, [open, version]);

  const dismiss = () => {
    if (version) {
      window.localStorage.setItem(DISMISSED_KEY, version);
      track({ name: "update_dismissed", props: { version } });
    }
    setDismissed(version);
  };

  const install = async () => {
    track({ name: "update_install_clicked", props: { version } });
    setInstalling(true);
    try {
      await fetch("/api/update/install", { method: "POST" });
    } catch {
      /* main also polls; the click is recorded server-side on retry */
    }
    // If we're still here after the timeout, the swap+relaunch didn't happen.
    window.setTimeout(() => setInstallStalled(true), INSTALL_TIMEOUT_MS);
  };

  const cancelStalledInstall = async () => {
    try { await fetch("/api/update/clear", { method: "POST" }); } catch { /* best effort */ }
    setInstalling(false);
    setInstallStalled(false);
    setDismissed(version); // don't immediately re-prompt this version
  };

  if (installing) {
    return (
      <Modal.Root open onOpenChange={() => { /* not dismissable mid-install */ }}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{installStalled ? "Update didn't start" : "Updating…"}</Modal.Title>
            <Modal.Description>
              {installStalled
                ? `Version ${version} couldn't install just now. You can keep using this version and try again later.`
                : `Installing version ${version} and restarting.`}
            </Modal.Description>
          </Modal.Header>
          {installStalled && (
            <Modal.Footer>
              <Button variant="primary" onClick={cancelStalledInstall}>Keep using this version</Button>
            </Modal.Footer>
          )}
        </Modal.Content>
      </Modal.Root>
    );
  }

  if (!open) return null;

  return (
    <Modal.Root open onOpenChange={(v) => { if (!v) dismiss(); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Update available — {version}</Modal.Title>
          <Modal.Description>A newer version of Arcade Studio is ready to install.</Modal.Description>
        </Modal.Header>
        <Modal.Footer>
          <Button variant="tertiary" onClick={dismiss}>Later</Button>
          <Button variant="primary" onClick={install}>Install &amp; restart</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
