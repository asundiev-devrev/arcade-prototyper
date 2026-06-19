import * as React from "react";

// Recognizable inline-SVG brand marks for the Connectors page. Real logo
// geometry (official paths where practical) so cards read like the product —
// not colored blobs. Keyed by the connector display name.
export const BRAND_LOGOS: Record<string, React.ReactNode> = {
  Github: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#181717" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.3-1.8-1.3-1.8-1.1-.7 0-.7 0-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2 0-.3-.5-1.5.2-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z"/>
    </svg>
  ),
  Gmail: (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75L35 40h7c1.66 0 3-1.34 3-3z"/>
      <path fill="#1e88e5" d="M3 16.2l3.61 1.71L13 23.7V40H6c-1.66 0-3-1.34-3-3z"/>
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"/>
      <path fill="#c62828" d="M3 12.3v3.9l10 7.5V11.2L9.88 8.86A4.7 4.7 0 0 0 7.3 8 4.3 4.3 0 0 0 3 12.3z"/>
      <path fill="#fbc02d" d="M45 12.3v3.9l-10 7.5V11.2l3.12-2.34A4.7 4.7 0 0 1 40.7 8 4.3 4.3 0 0 1 45 12.3z"/>
    </svg>
  ),
  "Granola MCP": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4b4b4b" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M12 12a2 2 0 1 0-1.9-2.6M12 12a4.5 4.5 0 1 1-4.4-5.5M12 12a7 7 0 1 0-6.8 5.4"/>
    </svg>
  ),
  "Notion MCP": (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="2.5" width="18" height="19" rx="3" fill="#fff" stroke="#111" strokeWidth="1.2"/>
      <path d="M8.4 7.2v9.6M8.4 7.2l7.2 9.6M15.6 7.2v9.6" stroke="#111" strokeWidth="1.8" fill="none" strokeLinecap="square"/>
    </svg>
  ),
  "Slack MCP": (
    <svg width="22" height="22" viewBox="0 0 122 122" aria-hidden="true">
      <path d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9z" fill="#E01E5A"/>
      <path d="M32.3 77.6a12.9 12.9 0 1 1 25.8 0v32.3a12.9 12.9 0 1 1-25.8 0z" fill="#E01E5A"/>
      <path d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9z" fill="#36C5F0"/>
      <path d="M45.2 32.3a12.9 12.9 0 1 1 0 25.8H12.9a12.9 12.9 0 1 1 0-25.8z" fill="#36C5F0"/>
      <path d="M96.3 45.2a12.9 12.9 0 1 1 12.9 12.9H96.3z" fill="#2EB67D"/>
      <path d="M89.8 45.2a12.9 12.9 0 1 1-25.8 0V12.9a12.9 12.9 0 1 1 25.8 0z" fill="#2EB67D"/>
      <path d="M76.9 96.3a12.9 12.9 0 1 1-12.9 12.9V96.3z" fill="#ECB22E"/>
      <path d="M76.9 89.8a12.9 12.9 0 1 1 0-25.8h32.3a12.9 12.9 0 1 1 0 25.8z" fill="#ECB22E"/>
    </svg>
  ),
  "Google Calendar": (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" fill="#fff" stroke="#e0e0e0" strokeWidth="0.5"/>
      <path d="M4 6a2 2 0 0 1 2-2h2v4H4z" fill="#4285F4"/>
      <path d="M16 4h2a2 2 0 0 1 2 2v2h-4z" fill="#EA4335"/>
      <path d="M4 16h4v4H6a2 2 0 0 1-2-2z" fill="#34A853"/>
      <path d="M16 20v-4h4v2a2 2 0 0 1-2 2z" fill="#FBBC04"/>
      <text x="12" y="15.6" fontSize="7" fontWeight="700" textAnchor="middle" fill="#4285F4">31</text>
    </svg>
  ),
  "Google Drive": (
    <svg width="22" height="22" viewBox="0 0 87.3 78" aria-hidden="true">
      <path fill="#0066da" d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z"/>
      <path fill="#00ac47" d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.4C.4 49.8 0 51.35 0 52.9h27.5z"/>
      <path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.7l5.85 11.5z"/>
      <path fill="#00832d" d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"/>
      <path fill="#2684fc" d="M59.7 52.9H27.5L13.75 76.7c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"/>
      <path fill="#ffba00" d="M73.4 26.5L60.75 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.05 27.9h27.45c0-1.55-.4-3.1-1.2-4.5z"/>
    </svg>
  ),
  Notion: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="2.5" width="18" height="19" rx="3" fill="#fff" stroke="#111" strokeWidth="1.2"/>
      <path d="M8.4 7.2v9.6M8.4 7.2l7.2 9.6M15.6 7.2v9.6" stroke="#111" strokeWidth="1.8" fill="none" strokeLinecap="square"/>
    </svg>
  ),
  Slack: (
    <svg width="22" height="22" viewBox="0 0 122 122" aria-hidden="true">
      <path d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9z" fill="#E01E5A"/>
      <path d="M32.3 77.6a12.9 12.9 0 1 1 25.8 0v32.3a12.9 12.9 0 1 1-25.8 0z" fill="#E01E5A"/>
      <path d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9z" fill="#36C5F0"/>
      <path d="M45.2 32.3a12.9 12.9 0 1 1 0 25.8H12.9a12.9 12.9 0 1 1 0-25.8z" fill="#36C5F0"/>
      <path d="M96.3 45.2a12.9 12.9 0 1 1 12.9 12.9H96.3z" fill="#2EB67D"/>
      <path d="M89.8 45.2a12.9 12.9 0 1 1-25.8 0V12.9a12.9 12.9 0 1 1 25.8 0z" fill="#2EB67D"/>
      <path d="M76.9 96.3a12.9 12.9 0 1 1-12.9 12.9V96.3z" fill="#ECB22E"/>
      <path d="M76.9 89.8a12.9 12.9 0 1 1 0-25.8h32.3a12.9 12.9 0 1 1 0 25.8z" fill="#ECB22E"/>
    </svg>
  ),
  Jira: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#2684FF" d="M11.6 2.1L20.9 11.4a1.5 1.5 0 0 1 0 2.1L11.6 22.8 3 14.2a1.5 1.5 0 0 1 0-2.1z"/>
      <path fill="#fff" opacity="0.45" d="M11.6 8L7.6 12l4 4 4-4z"/>
    </svg>
  ),
};

export function BrandTile({ name }: { name: string }) {
  const logo = BRAND_LOGOS[name];
  if (logo) return <>{logo}</>;
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-square text-body-small"
      style={{ background: "var(--bg-neutral-soft)", color: "var(--fg-neutral-medium)" }}>
      {name.charAt(0)}
    </span>
  );
}
