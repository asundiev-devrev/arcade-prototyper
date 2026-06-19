/**
 * ComputerScene — populated, interactive Computer / Agent Studio chat screen.
 *
 * The "batteries-included" sibling of `ComputerPage`. While `ComputerPage`
 * is a slot graph (caller fills sidebar + header + chatInput + body),
 * `ComputerScene` is a *complete*, working scene: a sessions list (clickable,
 * swaps the active session and the header title), a chats list, a transcript
 * the user can extend by typing into the command bar, an optional artefacts
 * panel, and a user footer.
 *
 *   <ComputerScene />                 // full populated, interactive scene
 *   <ComputerScene state="empty" />   // wordmark empty state
 *   <ComputerScene withCanvasPanel /> // mounts the right-hand artefacts panel
 *
 * Why this exists:
 * - Designers prompting "make a Computer chat screen" want the WHOLE
 *   prototype on the first turn — sessions populated, chats populated,
 *   header populated, transcript populated, AND clickable / typeable. Not
 *   an empty `<ComputerPage />` skeleton.
 * - The agent reaches for `<ComputerScene />` and cannot under-populate the
 *   kit by accident. Overrides are limited to values designers most often
 *   tweak (state, header title, canvas panel, user identity, sessions).
 *
 * Interactivity (built-in, no caller wiring required):
 * - Clicking a session in the sidebar swaps the active session and the
 *   header title to that session's `topic`.
 * - Typing into the bottom command bar and pressing Enter appends a user
 *   bubble; an agent reply follows ~700ms later (deterministic placeholder
 *   text). Shift+Enter inserts a newline.
 * - Toggling the right-hand artefacts panel via header — when
 *   `withCanvasPanel` is left at default, the header carries a toggle button.
 *
 * @counterexample Do NOT wrap `<ComputerScene />` in a `<ComputerPage>`. ComputerScene already IS a full Computer page (it composes ComputerPage internally). Wrapping it doubles the chrome.
 * @counterexample Do NOT use ComputerScene when the designer asks for a *custom* sidebar / header / transcript shape. Use `ComputerPage` (the slot graph) for that. Reach for ComputerScene only when the prompt is generic ("a Computer chat screen", "Agent Studio screen") and the designer wants the canonical kit layout.
 * @counterexample Do NOT pass children to `<ComputerScene>{...}</ComputerScene>` — it accepts none. The body is selected by the `state` prop.
 *
 * @tokens
 *  | Intent                        | Token                              |
 *  |---|---|
 *  | Window backdrop               | `--surface-backdrop` (applied by ComputerPage) |
 *  | Sidebar surface               | `--surface-shallow` (applied by ComputerSidebar) |
 *  | Body surface                  | `--surface-overlay` (applied by ComputerPage) |
 *  | Active sidebar item           | `--control-bg-neutral-subtle-active` |
 *  | Sidebar item hover            | `--control-bg-neutral-subtle-hover` |
 *  | Section label / muted text    | `--fg-neutral-subtle`              |
 *  | Primary text                  | `--fg-neutral-prominent`           |
 *  | Divider above ChatInput       | `--stroke-neutral-subtle`          |
 */
import * as React from "react";
import {
  Avatar,
  IconButton,
  Bell,
  ChatBubble,
  Clock,
  Document as DocumentIcon,
  DotInRightWindow,
  Globe,
  ThreeDotsHorizontal,
} from "@xorkavi/arcade-gen";
import { ComputerSidebar } from "./ComputerSidebar.js";
import { ComputerHeader } from "./ComputerHeader.js";
import { ChatInput } from "./ChatInput.js";
import { ChatEmptyState } from "./ChatEmptyState.js";
import { ChatMessages } from "./ChatMessages.js";
import { CanvasPanel } from "./CanvasPanel.js";
import { CanvasTabs } from "./CanvasTabs.js";
import { ComputerPage } from "../templates/ComputerPage.js";

/* ─── Baked-in roster (mirrors the colleague prototype) ─────────────────── */

type Session = {
  id: string;
  name: string;
  /** Header title shown when this session is active. */
  topic: string;
  /** Render a small unread indicator on the right of the row. */
  unread?: boolean;
  /** Optional avatar URL on the right of the row (collaborator hint). */
  collaboratorAvatar?: string;
};

const DEFAULT_SESSIONS: Session[] = [
  { id: "creative-rev", name: "Creative Framework Revision", topic: "Refresh the creative framework", unread: true },
  { id: "design-collab", name: "Design Collaboration Workshop", topic: "Plan the design collaboration workshop", unread: true },
  {
    id: "project-sync",
    name: "Project Sync-Up Meeting",
    topic: "Project sync-up agenda",
    collaboratorAvatar: "https://randomuser.me/api/portraits/women/44.jpg",
  },
  { id: "strategic", name: "Strategic Planning Session", topic: "Prepare marketing presentation" },
  { id: "creative-review", name: "Creative Framework Review", topic: "Review the creative framework", unread: true },
  { id: "q3-launch-recap", name: "Q3 Launch Recap", topic: "Summarise the Q3 launch outcomes" },
  { id: "growth-experiments", name: "Growth Experiments Backlog", topic: "Triage the growth experiments backlog" },
  { id: "customer-interviews", name: "Customer Interviews Synthesis", topic: "Synthesise customer interview notes" },
  { id: "pricing-tiers", name: "Pricing Tiers Workshop", topic: "Workshop the new pricing tiers" },
  { id: "onboarding-revamp", name: "Onboarding Revamp", topic: "Plan the onboarding revamp" },
  { id: "h1-okrs", name: "H1 OKRs Drafting", topic: "Draft the H1 OKRs" },
];

const SESSIONS_VISIBLE_DEFAULT = 5;

type Chat = { id: string; name: string; avatar?: string };

const CHATS: Chat[] = [
  { id: "user", name: "User" },
  { id: "shravan", name: "Shravan", avatar: "https://randomuser.me/api/portraits/men/32.jpg" },
  { id: "samantha", name: "Samantha", avatar: "https://randomuser.me/api/portraits/women/68.jpg" },
  { id: "thomas", name: "Thomas", avatar: "https://randomuser.me/api/portraits/women/79.jpg" },
  { id: "alice", name: "Alice", avatar: "https://randomuser.me/api/portraits/women/65.jpg" },
  { id: "brian", name: "Brian", avatar: "https://randomuser.me/api/portraits/men/41.jpg" },
  { id: "catherine", name: "Catherine", avatar: "https://randomuser.me/api/portraits/women/52.jpg" },
  { id: "david", name: "David", avatar: "https://randomuser.me/api/portraits/women/29.jpg" },
];

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string };

const SEED_TRANSCRIPT: Message[] = [
  {
    id: 1,
    role: "user",
    text: "Help me prep a marketing keynote for the Q3 launch — I want a tight outline I can riff off in front of the team tomorrow.",
  },
  {
    id: 2,
    role: "assistant",
    text: "Here's a starting outline — I can expand any section. Want me to draft slide copy, build a structure, or pull together visual references?",
  },
  { id: 3, role: "user", text: "Build the structure first." },
  {
    id: 4,
    role: "assistant",
    text: "A 5-act structure works for this audience: open with the customer problem, frame the wedge, walk through the product surface, hand off to a live demo, close on commercial signal. Want me to flesh out any act?",
  },
];

const AGENT_REPLIES = [
  "Got it — give me a beat to pull that together. I'll start with the structure and call out anything I'm unsure about.",
  "Here's a first pass. I leaned on the existing brief for tone; happy to take it brighter or tighter, just say the word.",
  "Done. Want me to keep going on this thread, or swap into something else?",
  "Working on it now. Anything specific you want me to weight more heavily?",
];

export type ComputerSceneProps = {
  /**
   * Body content state. Default `"transcript"` (a settled multi-turn
   * conversation the user can extend by typing). `"empty"` shows the
   * centered Computer wordmark; `"streaming"` ends the seed with a
   * working-thoughts agent turn.
   */
  state?: "empty" | "streaming" | "transcript";
  /**
   * Mount the right-hand artefacts panel. When `undefined` (default), the
   * header carries a toggle and the panel can be opened/closed at runtime.
   * Pass `true`/`false` to fix it open or closed.
   */
  withCanvasPanel?: boolean;
  /**
   * Conversation title in the ComputerHeader. When omitted, derived from
   * the active session.
   */
  headerTitle?: React.ReactNode;
  /** Sidebar user-footer overrides. */
  userName?: React.ReactNode;
  userSubtitle?: React.ReactNode;
  userAvatarSrc?: string;
  /** Active session id. Default `"strategic"`. */
  activeSessionId?: string;
  /** Override the default sessions roster. */
  sessions?: Session[];
  /** Placeholder for the bottom command bar. */
  chatInputPlaceholder?: string;
};

export function ComputerScene({
  state = "transcript",
  withCanvasPanel,
  headerTitle,
  userName = "Ava Wright",
  userSubtitle = "DevRev",
  userAvatarSrc,
  activeSessionId: activeSessionIdProp = "strategic",
  sessions = DEFAULT_SESSIONS,
  chatInputPlaceholder = "Ask me anything",
}: ComputerSceneProps = {}) {
  const [activeId, setActiveId] = React.useState(activeSessionIdProp);
  const activeSession =
    sessions.find((s) => s.id === activeId) ?? sessions[0] ?? DEFAULT_SESSIONS[3];

  const initialTranscript: Message[] = state === "empty" ? [] : SEED_TRANSCRIPT;
  const [messages, setMessages] = React.useState<Message[]>(initialTranscript);
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(withCanvasPanel ?? false);
  const [sessionsOpen, setSessionsOpen] = React.useState(true);
  const [sessionsExpanded, setSessionsExpanded] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [sidebarWidth, setSidebarWidth] = React.useState(256); // SIDENAV_EXPANDED
  const [canvasWidth, setCanvasWidth] = React.useState(320); // CANVAS_WIDTH
  const replyIndex = React.useRef(0);

  const visibleSessions = sessionsExpanded
    ? sessions
    : sessions.slice(0, SESSIONS_VISIBLE_DEFAULT);
  const hasMoreSessions = sessions.length > SESSIONS_VISIBLE_DEFAULT;

  // If the caller controls `withCanvasPanel`, sync our local toggle state.
  React.useEffect(() => {
    if (typeof withCanvasPanel === "boolean") setPanelOpen(withCanvasPanel);
  }, [withCanvasPanel]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || pending) return;
    const now = Date.now();
    setMessages((prev) => [...prev, { id: now, role: "user", text }]);
    setDraft("");
    setPending(true);
    const replyText = AGENT_REPLIES[replyIndex.current % AGENT_REPLIES.length] ?? "Working on it.";
    replyIndex.current += 1;
    window.setTimeout(() => {
      setMessages((prev) => [...prev, { id: now + 1, role: "assistant", text: replyText }]);
      setPending(false);
    }, 700);
  };

  const resolvedHeaderTitle = headerTitle ?? activeSession.topic;
  const showStreaming = state === "streaming" && messages === SEED_TRANSCRIPT;

  return (
    <ComputerPage
      sidebar={
        <ComputerSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          canvasOpen={panelOpen}
          width={sidebarWidth}
          onResize={setSidebarWidth}
          historyAction={
            <IconButton
              aria-label={sessionsOpen ? "Hide sessions" : "Show sessions"}
              variant="secondary"
              size="lg"
              onClick={() => setSessionsOpen((v) => !v)}
            >
              {sessionsOpen ? (
                <>
                  {/* Sessions visible → X (hide). In the rail, Sessions are
                      force-hidden by collapse, so swap to the Clock (show)
                      glyph via the same collapse classes — covers both the
                      JS-pinned and width-forced rail. */}
                  <span className={[
                    "inline-flex group-data-[collapsed=true]/sidebar:hidden @max-[600px]:hidden",
                    panelOpen ? "@max-[900px]:hidden" : "",
                  ].join(" ")}>
                    <CloseGlyph />
                  </span>
                  <span className={[
                    "hidden group-data-[collapsed=true]/sidebar:inline-flex @max-[600px]:inline-flex",
                    panelOpen ? "@max-[900px]:inline-flex" : "",
                  ].join(" ")}>
                    <Clock size={20} />
                  </span>
                </>
              ) : (
                <Clock size={20} />
              )}
            </IconButton>
          }
          user={
            <ComputerSidebar.User
              name={userName}
              subtitle={userSubtitle}
              avatar={
                <Avatar
                  name={typeof userName === "string" ? userName : "Ava Wright"}
                  src={userAvatarSrc ?? "https://randomuser.me/api/portraits/women/76.jpg"}
                  size="md"
                />
              }
            />
          }
          footerAction={<NotificationsBell />}
        >
          {sessionsOpen ? (
            <ComputerSidebar.Group title="Sessions" hideOnCollapse>
              {visibleSessions.map((s) => (
                <ComputerSidebar.Item
                  key={s.id}
                  trailing={<SessionTrailing session={s} />}
                  active={s.id === activeId}
                  emphasis={s.unread ? "strong" : "normal"}
                  onClick={() => setActiveId(s.id)}
                  onMenu={() => {}}
                >
                  {s.name}
                </ComputerSidebar.Item>
              ))}
              {hasMoreSessions ? (
                <ComputerSidebar.Item
                  leading={<ThreeDotsHorizontal size={16} />}
                  onClick={() => setSessionsExpanded((v) => !v)}
                >
                  <span className="text-(--fg-neutral-subtle)">
                    {sessionsExpanded ? "Less" : "More"}
                  </span>
                </ComputerSidebar.Item>
              ) : null}
            </ComputerSidebar.Group>
          ) : null}

          <ComputerSidebar.Group title="Chats">
            {CHATS.map((c) => (
              <ComputerSidebar.Item
                key={c.id}
                leading={<Avatar name={c.name} src={c.avatar} size="sm" />}
                onMenu={() => {}}
              >
                {c.name}
              </ComputerSidebar.Item>
            ))}
          </ComputerSidebar.Group>
        </ComputerSidebar>
      }
      header={
        <ComputerHeader
          title={resolvedHeaderTitle}
          actions={<CollaboratorStack />}
          panelToggle={
            <IconButton
              variant={panelOpen ? "primary" : "tertiary"}
              aria-label={panelOpen ? "Close artefacts panel" : "Open artefacts panel"}
              onClick={() => setPanelOpen((v) => !v)}
              className={panelOpen ? undefined : "text-(--fg-neutral-prominent)"}
            >
              <DotInRightWindow size={16} aria-hidden="true" />
            </IconButton>
          }
        />
      }
      chatInput={
        <ChatInput
          multiline
          placeholder={chatInputPlaceholder}
          value={draft}
          onChange={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onSubmit={send}
          trailing={
            <>
              <ChatInput.AddAttachmentButton aria-label="Attach" />
              {draft.trim() ? (
                <ChatInput.SendButton onClick={() => send(draft)} disabled={pending} />
              ) : null}
            </>
          }
        />
      }
      panel={
        panelOpen ? (
          <CanvasTabs
            width={canvasWidth}
            onResize={setCanvasWidth}
            tabs={[
              { id: "canvas", label: "Canvas" },
              { id: "docs", label: "Q3 launch brief.doc" },
            ]}
          >
            {(active) =>
              active === "canvas" ? (
                <DefaultCanvasPanel />
              ) : (
                <div className="p-6 text-body-medium text-(--fg-neutral-subtle)">
                  Document preview
                </div>
              )
            }
          </CanvasTabs>
        ) : undefined
      }
      onCanvasClose={() => setPanelOpen(false)}
    >
      {messages.length === 0 ? (
        <ChatEmptyState />
      ) : (
        <Transcript messages={messages} streaming={showStreaming || pending} />
      )}
    </ComputerPage>
  );
}

/* ─── Transcript renderer ───────────────────────────────────────────────── */

function Transcript({ messages, streaming }: { messages: Message[]; streaming: boolean }) {
  return (
    <ChatMessages>
      {messages.map((m) =>
        m.role === "user" ? (
          <ChatBubble key={m.id} variant="sender">
            {m.text}
          </ChatBubble>
        ) : (
          <ChatMessages.Agent
            key={m.id}
            thoughts={<ChatMessages.Thoughts label="Thought for 4s" />}
          >
            {m.text}
            <ChatMessages.Actions />
          </ChatMessages.Agent>
        ),
      )}
      {streaming ? (
        <ChatMessages.Agent
          thoughts={
            <ChatMessages.Thoughts label="Working" expanded>
              <ChatMessages.ThoughtItem subtitle="Q3 brief.pdf">
                Reading the launch brief
              </ChatMessages.ThoughtItem>
              <ChatMessages.ThoughtItem subtitle="brand-deck-v2.fig">
                Pulling visual references
              </ChatMessages.ThoughtItem>
              <ChatMessages.ThoughtItem status="loading">
                Sketching slide structure
              </ChatMessages.ThoughtItem>
            </ChatMessages.Thoughts>
          }
        />
      ) : null}
    </ChatMessages>
  );
}

/* ─── Header helpers ────────────────────────────────────────────────────── */

const COLLABORATOR_AVATARS: Array<{ name: string; src: string }> = [
  { name: "Shravan", src: "https://randomuser.me/api/portraits/men/32.jpg" },
  { name: "Samantha", src: "https://randomuser.me/api/portraits/women/68.jpg" },
  { name: "Thomas", src: "https://randomuser.me/api/portraits/women/79.jpg" },
];

function CollaboratorStack() {
  return (
    <div className="flex -space-x-1.5 mr-1">
      {COLLABORATOR_AVATARS.map((c) => (
        <span
          key={c.name}
          className="ring-2 ring-(--surface-overlay) rounded-circle inline-flex"
        >
          <Avatar name={c.name} src={c.src} size="sm" />
        </span>
      ))}
    </div>
  );
}

/* ─── Sidebar trailing helpers ──────────────────────────────────────────── */

function SessionTrailing({ session }: { session: Session }) {
  return (
    <span className="flex items-center gap-1.5">
      {session.collaboratorAvatar ? (
        <Avatar name={session.name} src={session.collaboratorAvatar} size="sm" />
      ) : null}
      {session.unread ? (
        <span className="w-1.5 h-1.5 rounded-circle bg-(--bg-info-prominent)" aria-label="Unread" />
      ) : null}
    </span>
  );
}

function NotificationsBell() {
  return (
    <span className="relative inline-flex">
      <IconButton variant="tertiary" size="sm" aria-label="Notifications">
        <Bell size={18} />
      </IconButton>
      <span className="pointer-events-none absolute top-0.5 right-0.5 w-2 h-2 rounded-circle bg-(--bg-info-prominent) ring-2 ring-(--surface-overlay)" />
    </span>
  );
}

/* ─── Sidebar history-button "X" glyph (when sessions are open) ─────────── */

function CloseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ─── Default canvas panel ──────────────────────────────────────────────── */

function DefaultCanvasPanel() {
  return (
    <CanvasPanel
      step={
        <CanvasPanel.Step
          current={2}
          total={4}
          title="Gather recent projects and form an agenda"
        />
      }
    >
      <CanvasPanel.Group title="Created in this topic">
        <CanvasPanel.Item
          leading={<CanvasPanel.FileIcon />}
          trailing={<CanvasPanel.StatusDot />}
        >
          Outline draft.md
        </CanvasPanel.Item>
        <CanvasPanel.Item
          leading={<CanvasPanel.FileIcon />}
          trailing={<CanvasPanel.StatusDot />}
        >
          Slide structure.docx
        </CanvasPanel.Item>
        <CanvasPanel.Item leading={<CanvasPanel.FileIcon />}>
          Talking points.md
        </CanvasPanel.Item>
      </CanvasPanel.Group>

      <CanvasPanel.Group title="On Ava's Macbook" trailing={<CanvasPanel.GroupAddButton />}>
        <CanvasPanel.Item leading={<CanvasPanel.FolderIcon />}>
          Q3 launch
        </CanvasPanel.Item>
        <CanvasPanel.Item leading={<CanvasPanel.FolderIcon />}>
          Brand assets
        </CanvasPanel.Item>
      </CanvasPanel.Group>

      <CanvasPanel.Group title="Sources (3)">
        <CanvasPanel.Item
          leading={<DocumentIcon size={16} />}
          trailing={<CanvasPanel.CountBadge>12</CanvasPanel.CountBadge>}
        >
          Notion
        </CanvasPanel.Item>
        <CanvasPanel.Item
          leading={<Globe size={16} />}
          trailing={<CanvasPanel.CountBadge>20</CanvasPanel.CountBadge>}
        >
          Gmail
        </CanvasPanel.Item>
      </CanvasPanel.Group>
    </CanvasPanel>
  );
}
