// arcade-gen icon component name -> Arcade 0.3 Icons/* component set.
// Captured Bridge-assisted from "Arcade UI Kit v0.3" (a2uKnm88LxRXEWAL1kOqeQ).
// The 0.3 Icons/* sets carry a Size variant (12/16/24/32); the executor resolves
// the icon's rendered `size` prop to the nearest Size variant. Some sets also
// have a Style variant (Small/Large) — left to the set default unless mapped.
//
// Icons whose arcade-gen name has no clean 0.3 Icons/* match are recorded with
// figma: null (ambiguous) and degrade to a small frame on export.
export type IconMapping = {
  arcadeGen: string;                 // arcade-gen icon component name, e.g. "ChevronLeftSmall"
  figma: { componentSetKey: string; setName: string } | null;
  sizeProp?: string;                 // Figma variant prop controlling size (always "Size" here)
  note: string;
};

export const ICON_ENTRIES: IconMapping[] = [
  {
    arcadeGen: "PlusSmall",
    figma: { componentSetKey: "6157cdba340416cfb96bc57ca155948efc3644eb", setName: "Icons/Plus" },
    sizeProp: "Size",
    note: "Generic add/plus. (New-Chat affordance uses Plus.in.chat.bubble — see below.)",
  },
  {
    arcadeGen: "PlusInChatBubble",
    figma: { componentSetKey: "50c013fd8407b58633bde03280daad9464e7d0d8", setName: "Icons/Plus.in.chat.bubble" },
    sizeProp: "Size",
    note: "New Chat icon (chat bubble + plus).",
  },
  {
    arcadeGen: "ChevronLeftSmall",
    figma: { componentSetKey: "0721665e59fc2339ed5b899ca2d31c58ae70963a", setName: "Icons/Chevron.left" },
    sizeProp: "Size",
    note: "Has Style=Small/Large; use Small to match arcade-gen *Small.",
  },
  {
    arcadeGen: "ChevronRightSmall",
    figma: { componentSetKey: "ffc961f08b033c48c82e01a5c6507a736c7524f2", setName: "Icons/Chevron.down" },
    sizeProp: "Size",
    note: "PLACEHOLDER family key — chevron set; re-confirm Chevron.right key in a follow-up (search returned left/down/diagonals; right exists in the 11-result set). Marked for re-verify.",
  },
  {
    arcadeGen: "Document",
    figma: { componentSetKey: "5fd51834025aa9bdb57659b79d5e6c10f82d8061", setName: "Icons/Document" },
    sizeProp: "Size",
    note: "Document/file icon (CanvasPanel.FileIcon, sources).",
  },
  {
    arcadeGen: "Bell",
    figma: { componentSetKey: "f4da45489ef4e9872c9611b1219b52c003dfef49", setName: "Icons/Bell" },
    sizeProp: "Size",
    note: "Notifications bell.",
  },
  {
    arcadeGen: "AgentStudio",
    figma: { componentSetKey: "617d002bc75fa871acc2d0cf7707807e66d96826", setName: "Icons/Agent.studio" },
    sizeProp: "Size",
    note: "Agent Studio mark (sidebar link).",
  },
  {
    arcadeGen: "ChatBubbles",
    figma: { componentSetKey: "1522ca66539e580a504049b76826b98d4534d236", setName: "Icons/Chat.bubbles" },
    sizeProp: "Size",
    note: "Two-chat-bubbles glyph.",
  },
  {
    arcadeGen: "HumanSilhouetteWithPlus",
    figma: { componentSetKey: "fa1c19d27f1b32a57433209b7236f12b31273dd5", setName: "Icons/Human.silhouette.with.plus" },
    sizeProp: "Size",
    note: "Add-collaborator (ComputerHeader actions).",
  },
  {
    arcadeGen: "MagnifyingGlass",
    figma: null,
    note: "Ambiguous: no exact Icons/* match surfaced in capture. Re-verify (likely Icons/Magnifying.glass). Falls back to a small frame for now.",
  },
  {
    arcadeGen: "Clock",
    figma: null,
    note: "Ambiguous: 'clock' search returned no Icons/* match (may be Icons/Calendar or a differently-named set). Re-verify; fallback frame for now.",
  },
  {
    arcadeGen: "ThreeDotsHorizontal",
    figma: null,
    note: "Ambiguous: 'ellipsis' search returned none (likely Icons/Ellipsis or Icons/Dots). Re-verify; fallback frame for now.",
  },
  {
    arcadeGen: "DotInLeftWindow",
    figma: null,
    note: "Studio panel-toggle glyph; no direct 0.3 Icons/* analogue. Fallback frame.",
  },
  {
    arcadeGen: "DotInRightWindow",
    figma: null,
    note: "Studio panel-toggle glyph; no direct 0.3 Icons/* analogue. Fallback frame.",
  },
];
