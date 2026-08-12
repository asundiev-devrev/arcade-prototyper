// arcade-gen icon component name -> Arcade 0.3 icon component set.
// Captured from "Arcade UI Kit v0.3" (a2uKnm88LxRXEWAL1kOqeQ). The sets carry a
// Size variant (12/16/24/32); the executor resolves the icon's rendered `size`
// prop to the nearest Size variant. Some sets also have a Style variant
// (Small/Large) — left to the set default unless mapped.
//
// `setName` MUST be the set's real published name, because it is not just
// documentation: buildExecuteScript's getLocalSet() falls back to an EXACT node-
// name match when the key doesn't resolve locally. Every entry here used to read
// "Icons/<Name>" (the page the sets sit on), but the sets publish under bare
// dotted names — "Plus.small", "Magnifying.glass" — so that fallback could never
// fire. Re-sourced live 2026-08-12 from
// GET /v1/files/a2uKnm88LxRXEWAL1kOqeQ/component_sets; all 14 keys resolved and
// every name was corrected to the published one.
//
// An icon with no clean 0.3 match would be recorded with figma: null (ambiguous)
// and degrade to a small frame on export. There are currently none.
export type IconMapping = {
  arcadeGen: string;                 // arcade-gen icon component name, e.g. "ChevronLeftSmall"
  figma: { componentSetKey: string; setName: string } | null;
  sizeProp?: string;                 // Figma variant prop controlling size (always "Size" here)
  note: string;
};

export const ICON_ENTRIES: IconMapping[] = [
  {
    arcadeGen: "PlusSmall",
    figma: { componentSetKey: "6157cdba340416cfb96bc57ca155948efc3644eb", setName: "Plus.small" },
    sizeProp: "Size",
    note: "Generic add/plus. (New-Chat affordance uses Plus.in.chat.bubble — see below.)",
  },
  {
    arcadeGen: "PlusInChatBubble",
    figma: { componentSetKey: "50c013fd8407b58633bde03280daad9464e7d0d8", setName: "Plus.in.chat.bubble" },
    sizeProp: "Size",
    note: "New Chat icon (chat bubble + plus).",
  },
  {
    arcadeGen: "ChevronLeftSmall",
    figma: { componentSetKey: "0721665e59fc2339ed5b899ca2d31c58ae70963a", setName: "Chevron.left.small" },
    sizeProp: "Size",
    note: "Has Style=Small/Large; use Small to match arcade-gen *Small.",
  },
  {
    arcadeGen: "ChevronRightSmall",
    figma: { componentSetKey: "35c3c725864838f2bd690bc7c8f7abaa88c4dc33", setName: "Chevron.right.small" },
    sizeProp: "Size",
    note: "Confirmed live 2026-06-09 (node 5389:5302) — was a placeholder Chevron.down key; corrected to the real Chevron.right.",
  },
  {
    arcadeGen: "Document",
    figma: { componentSetKey: "5fd51834025aa9bdb57659b79d5e6c10f82d8061", setName: "Document" },
    sizeProp: "Size",
    note: "Document/file icon (CanvasPanel.FileIcon, sources).",
  },
  {
    arcadeGen: "Bell",
    figma: { componentSetKey: "f4da45489ef4e9872c9611b1219b52c003dfef49", setName: "Bell" },
    sizeProp: "Size",
    note: "Notifications bell.",
  },
  {
    arcadeGen: "AgentStudio",
    figma: { componentSetKey: "617d002bc75fa871acc2d0cf7707807e66d96826", setName: "Agent.studio" },
    sizeProp: "Size",
    note: "Agent Studio mark (sidebar link).",
  },
  {
    arcadeGen: "ChatBubbles",
    figma: { componentSetKey: "1522ca66539e580a504049b76826b98d4534d236", setName: "Chat.bubbles" },
    sizeProp: "Size",
    note: "Two-chat-bubbles glyph.",
  },
  {
    arcadeGen: "HumanSilhouetteWithPlus",
    figma: { componentSetKey: "fa1c19d27f1b32a57433209b7236f12b31273dd5", setName: "Human.silhouette.with.plus" },
    sizeProp: "Size",
    note: "Add-collaborator (ComputerHeader actions).",
  },
  {
    arcadeGen: "MagnifyingGlass",
    figma: { componentSetKey: "2b018b8b41c3b389119a498cbc54b7453c04f9ea", setName: "Magnifying.glass" },
    sizeProp: "Size",
    note: "Resolved 2026-08-12 from GET /v1/files/a2uKnm88LxRXEWAL1kOqeQ/component_sets — the earlier capture missed it because the set publishes under the BARE dotted name 'Magnifying.glass', not 'Icons/Magnifying.glass'. Rejected the search-adjacent decoys in the same file: [DLS]Menu.Search, [🔴DEPRECATED]Menu/Utils/Search, Source/Search (a Conversation-page component, not a glyph).",
  },
  {
    arcadeGen: "Clock",
    figma: { componentSetKey: "2aa8ffa0acd31c83e3eb1dbd02f4e8ffaa3bc96e", setName: "Clock" },
    sizeProp: "Size",
    note: "Confirmed live 2026-06-09 (node 5389:6075) — real Icons/Clock found on the Icons page (history affordance).",
  },
  {
    arcadeGen: "ThreeDotsHorizontal",
    figma: { componentSetKey: "d1ae47b3993ae75198629a540818974865df03f2", setName: "Three.dots.horizontal" },
    sizeProp: "Size",
    note: "Resolved 2026-08-12. The earlier 'ellipsis' search missed it because the set is named after its SHAPE, not the concept — 'Three.dots.horizontal'. Rejected [🔴DEPRECATED] Ellipsis. Sibling 'Three.dots.vertical' (cbd495b6…) is the vertical variant, mapped separately.",
  },
  {
    arcadeGen: "DotInLeftWindow",
    figma: { componentSetKey: "c5852a9f5b1e585164b3a2489912f0741167823a", setName: "Dot.in.left.window" },
    sizeProp: "Size",
    note: "Resolved 2026-08-12 — the 0.3 analogue DOES exist as 'Dot.in.left.window' on the Icons page; the earlier note ('no direct analogue') was wrong.",
  },
  {
    arcadeGen: "DotInRightWindow",
    figma: { componentSetKey: "bc3bab1db6fe600a78be4d1c90476c22ea31c8b5", setName: "Dot.in.right.window" },
    sizeProp: "Size",
    note: "Resolved 2026-08-12 alongside Dot.in.left.window.",
  },
];
