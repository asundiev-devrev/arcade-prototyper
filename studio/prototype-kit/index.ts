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
export { Markdown } from "./composites/Markdown.js";
export type { MarkdownProps } from "./composites/Markdown.js";
export { ComputerScene } from "./composites/ComputerScene.js";
export type { ComputerSceneProps } from "./composites/ComputerScene.js";
export { SettingsCard } from "./composites/SettingsCard.js";
export { SettingsRow } from "./composites/SettingsRow.js";
export { VistaHeader } from "./composites/VistaHeader.js";
export { VistaToolbar } from "./composites/VistaToolbar.js";
export { VistaGroupRail } from "./composites/VistaGroupRail.js";
export { VistaRow } from "./composites/VistaRow.js";
export type { StageTone, PriorityValue } from "./composites/VistaRow.js";
export { VistaFilterPill } from "./composites/VistaFilterPill.js";
export { VistaPagination } from "./composites/VistaPagination.js";
export { FrameLink } from "./composites/FrameLink.js";
export { FormModal } from "./composites/FormModal.js";
export { FormField } from "./composites/FormField.js";
export { EntityCard } from "./composites/EntityCard.js";
export { CardGrid } from "./composites/CardGrid.js";
export { PickerModal } from "./composites/PickerModal.js";
export { DetailModal } from "./composites/DetailModal.js";
export { CapabilitySection } from "./composites/CapabilitySection.js";
export { MobileFrame } from "./composites/MobileFrame.js";

// Templates
export { SettingsPage } from "./templates/SettingsPage.js";
export { VistaPage } from "./templates/VistaPage.js";
export { ComputerPage } from "./templates/ComputerPage.js";
export { BuilderPage } from "./templates/BuilderPage.js";
