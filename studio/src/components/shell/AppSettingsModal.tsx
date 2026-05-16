import { useState, useEffect, useCallback } from "react";
import { Modal, Button, Input, Badge, Switch, Select } from "@xorkavi/arcade-gen";
import ReactMarkdown from "react-markdown";
import { savePat, getPatStatus, clearPat, type DevRevPatStatus } from "../../lib/devrev";

interface AppSettings {
  cloudflare?: {
    shareKey?: string;
  };
  studio?: {
    mode?: "light" | "dark";
    model?: string;
  };
}

// Sentinel for "use the Claude CLI's default model" in the Select UI.
// Radix Select (2.x) reserves the empty string as its internal "cleared"
// marker and throws at mount if any Select.Item is given value="". So we
// use a non-empty sentinel in the component and translate back to an
// empty-or-absent settings value on save/load. Persisted settings keep
// the historic shape (undefined or absent key means "CLI default").
const MODEL_DEFAULT_SENTINEL = "__default__";

// Keep in sync with claude CLI aliases. The first entry is the "let the
// CLI pick" option — persisted as undefined in settings.json.
const MODEL_OPTIONS: Array<{ value: string; label: string; hint?: string }> = [
  { value: MODEL_DEFAULT_SENTINEL, label: "Default (Sonnet)", hint: "CLI default — fast, cheap" },
  { value: "sonnet", label: "Sonnet", hint: "balanced default" },
  { value: "opus", label: "Opus", hint: "smarter, slower, more expensive" },
  { value: "haiku", label: "Haiku", hint: "fastest, cheapest, less nuanced" },
];

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

  // Figma state — mirrors the DevRev PAT layout. figmaStatus comes from
  // /api/figma/status (backed by `figmanage whoami`) so we reflect whatever
  // the CLI already has stored, no separate settings.json entry.
  const [figmaPat, setFigmaPat] = useState("");
  const [figmaStatus, setFigmaStatus] = useState<
    { authenticated: boolean; email?: string } | null
  >(null);
  const [figmaSaving, setFigmaSaving] = useState(false);
  const [figmaError, setFigmaError] = useState<string | null>(null);

  // Build version — shown in the footer. Sourced from package.json#version
  // by /api/version (electron-builder reads the same field at packaging
  // time); dev checkouts without a version field surface "dev" so we can
  // distinguish local builds at a glance when a beta tester pastes logs.
  const [versionLabel, setVersionLabel] = useState<string | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);

  // Cloudflare state — a single per-user share key. The Worker holds the
  // real Cloudflare API token; this key is what the Worker's ALLOWED_KEYS
  // secret checks against.
  const [cfShareKey, setCfShareKey] = useState("");
  const [hasCfToken, setHasCfToken] = useState(false);
  const [studioMode, setStudioMode] = useState<"light" | "dark">("light");
  // studioModel is the Select's current value — a sentinel when the user
  // has picked "Default (Sonnet)", otherwise one of the alias strings.
  // NEVER let this be "" — Radix Select throws on empty-string items.
  const [studioModel, setStudioModel] = useState<string>(MODEL_DEFAULT_SENTINEL);
  const [cfSaving, setCfSaving] = useState(false);
  const [cfError, setCfError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data: AppSettings = await res.json();
        setHasCfToken(!!data.cloudflare?.shareKey);
        if (data.studio?.mode === "dark" || data.studio?.mode === "light") {
          setStudioMode(data.studio.mode);
        }
        // Missing/empty in settings → show the Default row (sentinel).
        setStudioModel(data.studio?.model || MODEL_DEFAULT_SENTINEL);
      }
    } catch {
      // non-critical
    }
    try {
      setDevrevStatus(await getPatStatus());
    } catch {
      // non-critical
    }
    try {
      const res = await fetch("/api/figma/status");
      if (res.ok) {
        const body = await res.json();
        setFigmaStatus({
          authenticated: !!body.authenticated,
          email: body?.user?.email,
        });
      }
    } catch {
      // non-critical
    }
    try {
      const res = await fetch("/api/version");
      if (res.ok) {
        const body = await res.json();
        if (typeof body?.build === "string") setVersionLabel(body.build);
      }
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

  async function handleSaveFigma() {
    const trimmed = figmaPat.trim();
    if (!trimmed) return;
    setFigmaSaving(true);
    setFigmaError(null);
    try {
      const res = await fetch("/api/figma/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error?.message ?? `Login failed: ${res.status}`);
      }
      setFigmaPat("");
      // Re-fetch so the badge picks up the email figmanage just stored.
      const statusRes = await fetch("/api/figma/status");
      if (statusRes.ok) {
        const body = await statusRes.json();
        setFigmaStatus({
          authenticated: !!body.authenticated,
          email: body?.user?.email,
        });
      }
    } catch (e) {
      setFigmaError(e instanceof Error ? e.message : "Failed to save Figma PAT");
    } finally {
      setFigmaSaving(false);
    }
  }

  async function handleRemoveFigma() {
    setFigmaError(null);
    try {
      const res = await fetch("/api/figma/auth", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error?.message ?? `Logout failed: ${res.status}`);
      }
      setFigmaStatus({ authenticated: false });
      setFigmaPat("");
    } catch (e) {
      setFigmaError(e instanceof Error ? e.message : "Failed to remove Figma PAT");
    }
  }

  async function handleSaveCloudflare() {
    if (!cfShareKey.trim()) return;
    setCfSaving(true);
    setCfError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloudflare: { shareKey: cfShareKey.trim() },
        }),
      });
      if (!res.ok) throw new Error("Failed to save share key");
      await fetchSettings();
      setCfShareKey("");
    } catch (e) {
      setCfError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setCfSaving(false);
    }
  }

  async function handleRemoveCloudflare() {
    setCfError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Top-level null deletes the whole key via mergeSettings.
        body: JSON.stringify({ cloudflare: null }),
      });
      if (!res.ok) throw new Error("Failed to remove share key");
      setCfShareKey("");
      setHasCfToken(false);
    } catch (e) {
      setCfError(e instanceof Error ? e.message : "Failed to remove settings");
    }
  }

  return (
    <>
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

            {/* Generation model */}
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
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 540 }}>Generation model</h3>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                  Which Claude model the generator agent uses. Sonnet is the CLI
                  default — fast and usually sufficient. Switch to Opus for
                  trickier frames (slower and more expensive).
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="studio-model" style={{ fontSize: 12, fontWeight: 540 }}>
                  Model
                </label>
                <Select.Root
                  value={studioModel}
                  onValueChange={async (next: string) => {
                    const prev = studioModel;
                    setStudioModel(next);
                    // Sentinel → null so the PATCH's deep-merge explicitly
                    // deletes studio.model without clobbering sibling
                    // studio.* keys (e.g., studio.mode). The chat middleware
                    // then treats an absent key as "let the CLI pick".
                    const persisted =
                      next === MODEL_DEFAULT_SENTINEL ? null : next;
                    try {
                      await fetch("/api/settings", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          studio: { model: persisted },
                        }),
                      });
                    } catch {
                      setStudioModel(prev);
                    }
                  }}
                >
                  <Select.Trigger id="studio-model" />
                  <Select.Content>
                    {MODEL_OPTIONS.map((opt) => (
                      <Select.Item key={opt.value} value={opt.value}>
                        {opt.label}
                        {opt.hint ? (
                          <span style={{ marginLeft: 8, color: "var(--fg-neutral-subtle)", fontSize: 12 }}>
                            — {opt.hint}
                          </span>
                        ) : null}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
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

            {/* Figma */}
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
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 540 }}>Figma integration</h3>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                  Let Studio read Figma frames you reference in chat. Create a
                  token at{" "}
                  <a
                    href="https://www.figma.com/settings"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--fg-accent-prominent)", textDecoration: "underline" }}
                  >
                    figma.com/settings
                  </a>{" "}
                  → Security → Personal access tokens.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="figma-pat" style={{ fontSize: 12, fontWeight: 540 }}>
                  Personal access token
                </label>
                <Input
                  id="figma-pat"
                  type="password"
                  value={figmaPat}
                  onChange={(e) => setFigmaPat(e.target.value)}
                  placeholder={figmaStatus?.authenticated ? "Enter new token to replace" : "figd_..."}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleSaveFigma}
                  disabled={!figmaPat.trim() || figmaSaving}
                >
                  {figmaSaving ? "Saving…" : figmaStatus?.authenticated ? "Replace" : "Save"}
                </Button>
                {figmaStatus?.authenticated && (
                  <Button size="sm" variant="tertiary" onClick={handleRemoveFigma}>
                    Remove
                  </Button>
                )}
                {figmaStatus?.authenticated && (
                  <Badge variant="emphasis">Connected</Badge>
                )}
                {figmaStatus?.authenticated && figmaStatus.email && (
                  <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                    {figmaStatus.email}
                  </span>
                )}
              </div>

              {figmaError && (
                <div style={{ color: "var(--fg-alert-prominent)", fontSize: 12 }}>{figmaError}</div>
              )}
            </section>

            {/* Cloudflare */}
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
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 540 }}>Share to web</h3>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                  Deploy frames as shareable previews on the DevRev Product &
                  Design Cloudflare account. Paste the share key you received
                  from 1Password — the service handles the rest.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="cf-share-key" style={{ fontSize: 12, fontWeight: 540 }}>
                  Studio share key
                </label>
                <Input
                  id="cf-share-key"
                  type="password"
                  value={cfShareKey}
                  onChange={(e) => setCfShareKey(e.target.value)}
                  placeholder={hasCfToken ? "Enter new key to replace" : "64-char hex string"}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleSaveCloudflare}
                  disabled={!cfShareKey.trim() || cfSaving}
                >
                  {cfSaving ? "Saving…" : hasCfToken ? "Replace" : "Save"}
                </Button>
                {hasCfToken && (
                  <Button size="sm" variant="tertiary" onClick={handleRemoveCloudflare}>
                    Remove
                  </Button>
                )}
                {hasCfToken && <Badge variant="emphasis">Key configured</Badge>}
              </div>

              {cfError && (
                <div style={{ color: "var(--fg-alert-prominent)", fontSize: 12 }}>{cfError}</div>
              )}
            </section>

            {/* Version footer — sits inside the scrollable Body so it's
                visible without crowding the action buttons. The "What's
                new" link fetches /api/changelog and renders it in a nested
                modal; if the server has no changelog (old build without
                the Resources/CHANGELOG.md copy) the link is hidden. */}
            <div
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: "1px solid var(--stroke-neutral-subtle)",
                fontSize: 11,
                color: "var(--fg-neutral-subtle)",
                textAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <span>Arcade Studio {versionLabel ?? "…"}</span>
              <span>·</span>
              <button
                type="button"
                onClick={() => setChangelogOpen(true)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "var(--fg-accent-prominent)",
                  fontSize: 11,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                What's new
              </button>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={onClose} disabled={cfSaving || devrevSaving}>
            Close
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
    <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  );
}

function ChangelogModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBody(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/changelog");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const text = await res.text();
        if (!cancelled) setBody(text);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  return (
    <Modal.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>What's new</Modal.Title>
          <Modal.Description>Recent changes in Arcade Studio.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          {error ? (
            <div style={{ color: "var(--fg-alert-prominent)", fontSize: 13 }}>
              Couldn't load changelog: {error}
            </div>
          ) : body === null ? (
            <div style={{ color: "var(--fg-neutral-subtle)", fontSize: 13 }}>
              Loading…
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              <ReactMarkdown>{body}</ReactMarkdown>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
