import { useEffect, useState } from "react";
import { Modal, Button } from "@xorkavi/arcade-gen";
import ReactMarkdown from "react-markdown";
import {
  LAST_SEEN_VERSION_KEY,
  shouldShowWhatsNew,
  extractChangelogSection,
} from "../../lib/whatsNew";
import { track } from "../../lib/telemetry/renderer";

/**
 * First-launch-after-update notice. Updates apply silently (see
 * electron/updater.ts), so this is the ONE place the user learns the version
 * changed: on the first launch where the running version is newer than the last
 * version they saw, we auto-open the changelog scoped to that release.
 *
 * Records the seen version on mount regardless of whether the modal shows, so:
 *  - the modal never re-appears for a version once seen,
 *  - the first launch carrying this feature records silently (no prior version
 *    to compare against → no nag), and only later updates surface.
 *
 * Mounted once at the app root. No server changes — reuses /api/version and
 * /api/changelog.
 */
export function WhatsNewModal() {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let current: string | null = null;
      try {
        const res = await fetch("/api/version");
        if (res.ok) {
          const info = (await res.json()) as { build?: string; base?: string };
          current = info.build ?? info.base ?? null;
        }
      } catch {
        return; // version unknown → do nothing
      }
      if (cancelled || !current) return;

      const stored = window.localStorage.getItem(LAST_SEEN_VERSION_KEY);
      const show = shouldShowWhatsNew(stored, current);

      // Always advance the marker so a version is shown at most once, even if
      // the changelog fetch below fails.
      window.localStorage.setItem(LAST_SEEN_VERSION_KEY, current);
      if (!show) return;

      setVersion(current);
      // Scope the changelog to just this release; fall back to the full text if
      // the section can't be isolated (e.g. heading format drift).
      let text: string | null = null;
      try {
        const res = await fetch("/api/changelog");
        if (res.ok) text = await res.text();
      } catch {
        /* no changelog → modal still shows the header + a generic line */
      }
      if (cancelled) return;
      const section = text ? extractChangelogSection(text, current) : null;
      setBody(section ?? text ?? null);
      setOpen(true);
      track({ name: "whats_new_shown", props: { version: current } });
    })();
    return () => { cancelled = true; };
  }, []);

  if (!open) return null;

  return (
    <Modal.Root open={open} onOpenChange={(v) => { if (!v) setOpen(false); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Updated to {version}</Modal.Title>
          <Modal.Description>Arcade Studio just updated itself. Here's what's new.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          {body ? (
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              <ReactMarkdown>{body}</ReactMarkdown>
            </div>
          ) : (
            <div style={{ color: "var(--fg-neutral-subtle)", fontSize: 13 }}>
              You're now on version {version}.
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setOpen(false)}>Got it</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
