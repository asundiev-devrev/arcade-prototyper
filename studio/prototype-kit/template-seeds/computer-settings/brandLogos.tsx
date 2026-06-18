import * as React from "react";

// Minimal inline-SVG brand marks for the Connectors page. Simplified, single-
// path-ish glyphs tinted to each brand — recognizable without shipping real logo assets.
export const BRAND_LOGOS: Record<string, React.ReactNode> = {
  Gmail: <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#EA4335" d="M2 5l10 7L22 5v14H2z" opacity="0.9"/></svg>,
  "Outlook Email": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" fill="#0078D4"/></svg>,
  Salesforce: <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#00A1E0"/></svg>,
  HubSpot: <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#FF7A59"/></svg>,
  "Google Calendar": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" fill="#4285F4"/></svg>,
  "Outlook Calendar": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" fill="#0078D4"/></svg>,
  Gong: <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#8A3FFC"/></svg>,
  Zoom: <svg width="20" height="20" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4" fill="#2D8CFF"/></svg>,
  "Google Drive": <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#00AC47" d="M8 3h8l6 11H14z"/><path fill="#FFBA00" d="M2 14L8 3l6 11z"/></svg>,
  "Confluence Cloud": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="#1868DB"/></svg>,
  Notion: <svg width="20" height="20" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2" fill="#111"/></svg>,
  OneDrive: <svg width="20" height="20" viewBox="0 0 24 24"><ellipse cx="12" cy="14" rx="9" ry="5" fill="#0364B8"/></svg>,
  Slack: <svg width="20" height="20" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="4" fill="#4A154B"/></svg>,
  "Microsoft Teams": <svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="#6264A7"/></svg>,
  SharePoint: <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#038387"/></svg>,
  Jira: <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#2684FF" d="M12 2l9 9-9 9-9-9z"/></svg>,
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
