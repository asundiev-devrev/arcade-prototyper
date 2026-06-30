import * as React from "react";
import { ComputerScene } from "arcade-prototypes";
import ComputerSettingsTemplate from "./settings/index";

// Template seed: Computer / Agent Studio chat screen.
//
// This seed is also the chat ↔ settings SWAP HOST. ComputerScene (a kit
// composite) and the settings template (a seed under ./settings) sit on
// opposite sides of the kit/seed compile boundary and can't import each other
// — so the seed layer owns the `view` state and renders one or the other.
// Clicking "Settings" in the chat's account menu swaps to the settings view;
// the settings sidebar's back row returns to chat.
//
// The settings tree is NESTED under this directory (./settings) so a project
// that scaffolds "Computer: Chat" copies the whole tree and the swap survives
// outside the dev server. The standalone "Computer: Settings" template points
// at the same ./settings directory (see server/templates.ts).
export default function ComputerTemplate() {
  const [view, setView] = React.useState<"chat" | "settings">("chat");
  if (view === "settings") {
    return <ComputerSettingsTemplate onBack={() => setView("chat")} />;
  }
  return <ComputerScene onOpenSettings={() => setView("settings")} />;
}
