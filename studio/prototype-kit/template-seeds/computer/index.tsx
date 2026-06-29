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
  const transcript = [
    { id: 1, role: "user", text: "Help me prep a marketing keynote for the Q3 launch — I want a tight outline I can riff off in front of the team tomorrow." },
    { id: 2, role: "assistant", text: "Here's a starting outline — I can expand any section. Want me to draft slide copy, build a structure, or pull together visual references?", artefact: { tag: "DOC", title: "Q3 launch brief" } },
    { id: 3, role: "user", text: "Build the structure first." },
    { id: 4, role: "assistant", text: "A 5-act structure works for this audience: open with the customer problem, frame the wedge, walk through the product surface, hand off to a live demo, close on commercial signal. Want me to flesh out any act?" },
  ] as const;
  if (view === "settings") {
    return <ComputerSettingsTemplate onBack={() => setView("chat")} />;
  }
  return <ComputerScene transcript={transcript} onOpenSettings={() => setView("settings")} />;
}
