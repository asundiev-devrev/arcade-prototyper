// arcade-prototypes — prototyping-only composites and templates.
// See ./README.md for the separation rationale.
//
// Do not import this barrel from arcade-gen/src/. A test enforces this.

// Composites
export { AppShell } from "./composites/AppShell.js";
export { TitleBar } from "./composites/TitleBar.js";
export { BreadcrumbBar } from "./composites/BreadcrumbBar.js";
export { PageBody } from "./composites/PageBody.js";
export { NavSidebar } from "./composites/NavSidebar.js";
export { ComputerSidebar } from "./composites/ComputerSidebar.js";
export { ComputerHeader } from "./composites/ComputerHeader.js";
export { CanvasPanel } from "./composites/CanvasPanel.js";
export { ChatInput } from "./composites/ChatInput.js";
export { ChatEmptyState } from "./composites/ChatEmptyState.js";
export { ChatMessages } from "./composites/ChatMessages.js";
export { SettingsCard } from "./composites/SettingsCard.js";
export { SettingsRow } from "./composites/SettingsRow.js";
export { VistaHeader } from "./composites/VistaHeader.js";
export { VistaToolbar } from "./composites/VistaToolbar.js";
export { VistaGroupRail } from "./composites/VistaGroupRail.js";
export { VistaRow } from "./composites/VistaRow.js";
export type { StageTone, PriorityValue } from "./composites/VistaRow.js";

// Templates
export { SettingsPage } from "./templates/SettingsPage.js";
export { VistaPage } from "./templates/VistaPage.js";
