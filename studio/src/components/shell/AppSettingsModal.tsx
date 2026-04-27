import { useState, useEffect, useCallback } from "react";
import { Modal, Button, Input, Badge, Switch } from "@xorkavi/arcade-gen";
import { savePat, getPatStatus, clearPat, type DevRevPatStatus } from "../../lib/devrev";

interface AppSettings {
  vercel?: {
    token?: string;
    teamId?: string;
    projectName?: string;
  };
  studio?: {
    mode?: "light" | "dark";
  };
}

export function AppSettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // DevRev state
  const [pat, setPat] = useState("");
  const [devrevStatus, setDevrevStatus] = useState<DevRevPatStatus | null>(null);
  const [devrevSaving, setDevrevSaving] = useState(false);
  const [devrevError, setDevrevError] = useState<string | null>(null);

  // Vercel state
  const [vercelToken, setVercelToken] = useState("");
  const [vercelTeamId, setVercelTeamId] = useState("");
  const [vercelProjectName, setVercelProjectName] = useState("");
  const [hasVercelToken, setHasVercelToken] = useState(false);
  const [studioMode, setStudioMode] = useState<"light" | "dark">("light");
  const [vercelSaving, setVercelSaving] = useState(false);
  const [vercelError, setVercelError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data: AppSettings = await res.json();
        setHasVercelToken(!!data.vercel?.token);
        if (data.studio?.mode === "dark" || data.studio?.mode === "light") {
          setStudioMode(data.studio.mode);
        }
        setVercelTeamId(data.vercel?.teamId || "");
        setVercelProjectName(data.vercel?.projectName || "");
      }
    } catch {
      // non-critical
    }
    try {
      setDevrevStatus(await getPatStatus());
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    if (open) void fetchSettings();
  }, [open, fetchSettings]);

  async function handleSavePat() {
    if (!pat.trim()) return;
    setDevrevSaving(true);
    setDevrevError(null);
    try {
      const status = await savePat(pat.trim());
      setDevrevStatus(status);
      setPat("");
    } catch (e) {
      setDevrevError(e instanceof Error ? e.message : "Failed to save PAT");
    } finally {
      setDevrevSaving(false);
    }
  }

  async function handleRemovePat() {
    setDevrevError(null);
    try {
      await clearPat();
      setDevrevStatus({ configured: false });
      setPat("");
    } catch (e) {
      setDevrevError(e instanceof Error ? e.message : "Failed to remove PAT");
    }
  }

  async function handleSaveVercel() {
    setVercelSaving(true);
    setVercelError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vercel: {
            token: vercelToken.trim() || undefined,
            teamId: vercelTeamId.trim() || undefined,
            projectName: vercelProjectName.trim() || undefined,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save Vercel settings");
      await fetchSettings();
      setVercelToken("");
    } catch (e) {
      setVercelError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setVercelSaving(false);
    }
  }

  return (
    <Modal.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Settings</Modal.Title>
          <Modal.Description>Global settings shared across all projects.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Appearance */}
            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 540 }}>Appearance</h3>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                  Applies to the Studio shell. Each project's preview theme is
                  controlled by the toggle in the project header.
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Switch
                  checked={studioMode === "dark"}
                  onCheckedChange={async (next) => {
                    const mode: "light" | "dark" = next ? "dark" : "light";
                    setStudioMode(mode);
                    try {
                      await fetch("/api/settings", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ studio: { mode } }),
                      });
                      window.dispatchEvent(
                        new CustomEvent("arcade-studio:mode-changed", { detail: mode }),
                      );
                    } catch {
                      // revert on failure
                      setStudioMode(next ? "light" : "dark");
                    }
                  }}
                />
                <span style={{ fontSize: 13, color: "var(--fg-neutral-prominent)" }}>
                  Dark mode
                </span>
              </div>
            </section>

            {/* DevRev */}
            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 540 }}>DevRev integration</h3>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                  Connect to DevRev so generated prototypes can fetch live data. Create a PAT in the
                  DevRev app under Settings → Account → Personal access tokens.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="devrev-pat" style={{ fontSize: 12, fontWeight: 540 }}>
                  Personal access token
                </label>
                <Input
                  id="devrev-pat"
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder={devrevStatus?.configured ? "Enter new token to replace" : "dvu_..."}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleSavePat}
                  disabled={!pat.trim() || devrevSaving}
                >
                  {devrevSaving ? "Saving…" : devrevStatus?.configured ? "Replace" : "Save"}
                </Button>
                {devrevStatus?.configured && (
                  <Button size="sm" variant="tertiary" onClick={handleRemovePat}>
                    Remove
                  </Button>
                )}
                {devrevStatus?.configured && (
                  <Badge variant={devrevStatus.valid ? "emphasis" : "neutral"}>
                    {devrevStatus.valid ? "Connected" : "Invalid"}
                  </Badge>
                )}
                {devrevStatus?.valid && devrevStatus.user && (
                  <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                    {devrevStatus.user.display_name}
                  </span>
                )}
              </div>

              {devrevError && (
                <div style={{ color: "var(--fg-alert-prominent)", fontSize: 12 }}>{devrevError}</div>
              )}
            </section>

            {/* Vercel */}
            <section
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                paddingTop: 16,
                borderTop: "1px solid var(--stroke-neutral-subtle)",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 540 }}>Vercel integration</h3>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                  Deploy frames as shareable previews. Create a token at vercel.com/account/tokens.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="vercel-token" style={{ fontSize: 12, fontWeight: 540 }}>
                  Access token
                </label>
                <Input
                  id="vercel-token"
                  type="password"
                  value={vercelToken}
                  onChange={(e) => setVercelToken(e.target.value)}
                  placeholder={hasVercelToken ? "Enter new token to replace" : "vercel_..."}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="vercel-team" style={{ fontSize: 12, fontWeight: 540 }}>
                  Team ID (optional)
                </label>
                <Input
                  id="vercel-team"
                  value={vercelTeamId}
                  onChange={(e) => setVercelTeamId(e.target.value)}
                  placeholder="team_... (leave empty for personal account)"
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="vercel-project" style={{ fontSize: 12, fontWeight: 540 }}>
                  Project name (optional)
                </label>
                <Input
                  id="vercel-project"
                  value={vercelProjectName}
                  onChange={(e) => setVercelProjectName(e.target.value)}
                  placeholder="arcade-studio"
                />
              </div>

              {hasVercelToken && (
                <div>
                  <Badge variant="emphasis">Token configured</Badge>
                </div>
              )}

              {vercelError && (
                <div style={{ color: "var(--fg-alert-prominent)", fontSize: 12 }}>{vercelError}</div>
              )}
            </section>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={vercelSaving || devrevSaving}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleSaveVercel}
            disabled={vercelSaving || (!vercelToken.trim() && !hasVercelToken)}
          >
            {vercelSaving ? "Saving…" : "Save Vercel settings"}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
