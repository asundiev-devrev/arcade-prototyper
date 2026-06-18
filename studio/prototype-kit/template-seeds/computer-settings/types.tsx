import * as React from "react";
import { HumanSilhouette, ArrowsLeftAndRight, Computer, ThreeBarsHorizontal, LightingBolt, Mcp, Buildings, TwoHumanSilhouettes, CreditCard, Dashboard } from "arcade/components";

export type PageId =
  | "profile" | "preferences"
  | "my-computer" | "workflows-tools" | "skills" | "connectors"
  | "organization" | "users" | "plans-billing" | "usage";

export interface NavItem { id: PageId; label: string; icon: React.ReactNode; }
export interface NavGroup { title?: string; items: NavItem[]; }

export const NAV_GROUPS: NavGroup[] = [
  { items: [
    { id: "profile", label: "Profile", icon: <HumanSilhouette size={16} /> },
    { id: "preferences", label: "Preferences", icon: <ArrowsLeftAndRight size={16} /> },
  ]},
  { title: "Customization", items: [
    { id: "my-computer", label: "My Computer", icon: <Computer size={16} /> },
    { id: "workflows-tools", label: "Workflows & Tools", icon: <ThreeBarsHorizontal size={16} /> },
    { id: "skills", label: "Skills", icon: <LightingBolt size={16} /> },
    { id: "connectors", label: "Connectors", icon: <Mcp size={16} /> },
  ]},
  { title: "Account", items: [
    { id: "organization", label: "Organization", icon: <Buildings size={16} /> },
    { id: "users", label: "Users", icon: <TwoHumanSilhouettes size={16} /> },
    { id: "plans-billing", label: "Plans & Billing", icon: <CreditCard size={16} /> },
    { id: "usage", label: "Usage", icon: <Dashboard size={16} /> },
  ]},
];

export const PAGE_TITLES: Record<PageId, { title: string; subtitle: string }> = {
  "profile": { title: "Profile", subtitle: "Manage your personal information and account." },
  "preferences": { title: "Preferences", subtitle: "Tune appearance, language, and notifications." },
  "my-computer": { title: "My Computer", subtitle: "Personalise Computer to your own work style and control how it behaves." },
  "workflows-tools": { title: "Workflows & Tools", subtitle: "Browse and manage the tools your agent can use." },
  "skills": { title: "Skills", subtitle: "Discover and add capabilities for your agent." },
  "connectors": { title: "Connectors", subtitle: "Connect Computer to apps, tools, MCP, storage, and more." },
  "organization": { title: "Organization", subtitle: "Manage your organization's profile and settings." },
  "users": { title: "Users", subtitle: "Invite, remove, and manage users and their access roles." },
  "plans-billing": { title: "Plans and Billing", subtitle: "Manage payment methods, balances and billing preferences." },
  "usage": { title: "Usage", subtitle: "Track how your organization is using Computer." },
};
