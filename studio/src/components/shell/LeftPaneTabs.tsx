import { useState, useEffect, type MutableRefObject } from "react";
import { ChatPane } from "../chat/ChatPane";
import { AssetsPanel } from "../assets/AssetsPanel";
import type { ChatMessage, ChimeIn } from "../../../server/types";

const TAB_KEY = "studio:leftPaneTab";
type Tab = "chat" | "assets";

interface Props {
  projectSlug: string;
  history: ChatMessage[];
  seedRef: MutableRefObject<((text: string) => void) | null>;
  chimeIns: ChimeIn[];
  onApplyChimeIn: (c: ChimeIn) => void;
  onDismissChimeIn: (c: ChimeIn) => void;
}

export function LeftPaneTabs(props: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "chat";
    return window.localStorage.getItem(TAB_KEY) === "assets" ? "assets" : "chat";
  });
  useEffect(() => {
    window.localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        role="tablist"
        style={{ display: "flex", borderBottom: "1px solid var(--stroke-neutral-subtle)", flex: "0 0 auto" }}
      >
        {(["chat", "assets"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "8px 0",
              fontSize: 13,
              fontWeight: tab === t ? 600 : 500,
              color: tab === t ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-subtle)",
              background: "transparent",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--fg-accent-prominent)" : "2px solid transparent",
              cursor: "pointer",
            }}
          >
            {t === "chat" ? "Chat" : "Assets"}
          </button>
        ))}
      </div>
      {/* ChatPane stays mounted (preserve scroll + live stream); hidden when on Assets. */}
      <div style={{ flex: 1, minHeight: 0, display: tab === "chat" ? "flex" : "none", flexDirection: "column" }}>
        <ChatPane
          projectSlug={props.projectSlug}
          history={props.history}
          seedRef={props.seedRef}
          chimeIns={props.chimeIns}
          onApplyChimeIn={props.onApplyChimeIn}
          onDismissChimeIn={props.onDismissChimeIn}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: tab === "assets" ? "block" : "none", overflow: "hidden" }}>
        {tab === "assets" && (
          <AssetsPanel
            onSeed={(text) => props.seedRef.current?.(text)}
            onSeeded={() => setTab("chat")}
          />
        )}
      </div>
    </div>
  );
}
