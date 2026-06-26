import { type MutableRefObject } from "react";
import { ChatPane } from "../chat/ChatPane";
import { AssetsPanel } from "../assets/AssetsPanel";
import type { ChatMessage, ChimeIn } from "../../../server/types";

export type LeftPaneTab = "chat" | "assets";
export const LEFT_PANE_TAB_KEY = "studio:leftPaneTab";

interface Props {
  /** Active tab — controlled by the parent (the switch lives in the header). */
  tab: LeftPaneTab;
  /** Switch tabs (e.g. AssetsPanel "Use this" flips back to chat). */
  onTabChange: (tab: LeftPaneTab) => void;
  projectSlug: string;
  history: ChatMessage[];
  seedRef: MutableRefObject<((text: string) => void) | null>;
  chimeIns: ChimeIn[];
  onApplyChimeIn: (c: ChimeIn) => void;
  onDismissChimeIn: (c: ChimeIn) => void;
  onUndoBlock: (id: string) => void;
  onApplyBlock: (id: string) => void;
  onDiscardBlock: (id: string) => void;
}

export function LeftPaneTabs(props: Props) {
  const { tab } = props;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* ChatPane stays mounted (preserve scroll + live stream); hidden when on Assets. */}
      <div style={{ flex: 1, minHeight: 0, display: tab === "chat" ? "flex" : "none", flexDirection: "column" }}>
        <ChatPane
          projectSlug={props.projectSlug}
          history={props.history}
          seedRef={props.seedRef}
          chimeIns={props.chimeIns}
          onApplyChimeIn={props.onApplyChimeIn}
          onDismissChimeIn={props.onDismissChimeIn}
          onUndoBlock={props.onUndoBlock}
          onApplyBlock={props.onApplyBlock}
          onDiscardBlock={props.onDiscardBlock}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: tab === "assets" ? "block" : "none", overflow: "hidden" }}>
        {tab === "assets" && (
          <AssetsPanel
            onSeed={(text) => props.seedRef.current?.(text)}
            onSeeded={() => props.onTabChange("chat")}
          />
        )}
      </div>
    </div>
  );
}
