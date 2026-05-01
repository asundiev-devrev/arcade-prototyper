import { useEffect, useState } from "react";

/**
 * Unobtrusive banner shown at the top of the viewport when a newer
 * version of Studio is published on GitHub. Polls /api/version/check
 * once on mount; the server caches the upstream GitHub response so
 * frequent reloads don't hammer the API.
 *
 * Dismissable per-version: if the user hides the banner for 0.4.5,
 * they won't see it again for 0.4.5, but they will when 0.4.6 ships.
 * Keeps the nag level proportional to the value.
 *
 * Click "Download" opens the DMG asset URL in a new tab — the user
 * still installs manually (mount, drag to Applications). We can
 * revisit in-app install later once the app is signed + notarized.
 */

interface UpdateCheckResult {
  current: string;
  latest: string | null;
  unknown?: boolean;
  upToDate: boolean;
  downloadUrl: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
}

const DISMISS_KEY = "arcade-studio:update-banner-dismissed-version";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateCheckResult | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/version/check");
        if (!res.ok) return;
        const body = (await res.json()) as UpdateCheckResult;
        if (!cancelled) setInfo(body);
      } catch {
        // Silent fail — "couldn't check for updates" isn't worth alerting the user.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info || info.upToDate || info.unknown || !info.latest) return null;
  if (dismissedVersion === info.latest) return null;

  function dismiss() {
    if (!info?.latest) return;
    try { localStorage.setItem(DISMISS_KEY, info.latest); } catch { /* fine */ }
    setDismissedVersion(info.latest);
  }

  const { latest, current, downloadUrl, releaseUrl } = info;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "8px 16px",
        fontSize: 13,
        background: "var(--bg-intelligence-subtle, #eef3ff)",
        color: "var(--fg-intelligence-prominent, #24408e)",
        borderBottom: "1px solid var(--stroke-neutral-subtle, #e4e4e4)",
      }}
    >
      <span>
        <strong>Arcade Studio {latest}</strong> is available (you're on {current}).
      </span>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "underline", color: "inherit" }}
        >
          Download
        </a>
      ) : releaseUrl ? (
        <a
          href={releaseUrl}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "underline", color: "inherit" }}
        >
          Release notes
        </a>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss update notice"
        style={{
          marginLeft: 8,
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
          opacity: 0.6,
        }}
      >
        ×
      </button>
    </div>
  );
}
