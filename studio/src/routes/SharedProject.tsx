import { useEffect, useMemo, useState } from "react";
import { CommentInput } from "../components/multiplayer/CommentInput";
import { OfflineBanner } from "../components/multiplayer/OfflineBanner";

interface Mirror {
  id: string;
  hostDisplayName: string;
  projectSlug: string;
  lastSeenAt: string;
}

type Comment = {
  type: "comment_posted";
  id: string;
  byDevu: string;
  displayName: string;
  text: string;
  ts: number;
};

type RelayEvent = { type?: string; [k: string]: unknown };

function isComment(e: RelayEvent): e is Comment {
  return e?.type === "comment_posted" && typeof (e as Comment).text === "string";
}

export default function SharedProject({ id }: { id: string }) {
  const [meta, setMeta] = useState<Mirror | null>(null);
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [chat, setChat] = useState<RelayEvent[]>([]);
  const [status, setStatus] = useState<"online" | "offline" | "unknown">("unknown");

  useEffect(() => {
    fetch(`/api/shared-projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setMeta(d.metadata);
        setFrames(d.frames ?? {});
        setChat(d.chat ?? []);
      })
      .catch(() => {});
    const es = new EventSource(`/api/shared-projects/${id}/stream`);
    es.addEventListener("relay", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "frame_written") {
          setFrames((f) => ({ ...f, [ev.path]: ev.content }));
        } else if (ev.type === "frame_deleted") {
          setFrames((f) => {
            const next = { ...f };
            delete next[ev.path];
            return next;
          });
        } else {
          setChat((c) => [...c, ev]);
        }
      } catch {
        /* ignore malformed event */
      }
    });
    es.addEventListener("status", (e: MessageEvent) => {
      try {
        const { status } = JSON.parse(e.data);
        if (status === "online" || status === "offline") setStatus(status);
      } catch {
        /* ignore malformed event */
      }
    });
    return () => es.close();
  }, [id]);

  const comments = useMemo(() => chat.filter(isComment), [chat]);
  const frameEntries = useMemo(() => Object.entries(frames), [frames]);

  if (!meta) return <div style={{ padding: 24 }}>Loading shared project…</div>;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 320px",
        height: "100vh",
        background: "var(--surface-deep, #faf7f4)",
        color: "var(--fg-neutral-prominent, #211e20)",
      }}
    >
      <div style={{ overflow: "auto", display: "flex", flexDirection: "column" }}>
        {status === "offline" && <OfflineBanner hostName={meta.hostDisplayName} />}
        <header
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--stroke-neutral-subtle, #e5e0db)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{meta.projectSlug}</h1>
          <p style={{ margin: "4px 0 0", color: "var(--fg-neutral-subtle, #6a5a7d)", fontSize: 13 }}>
            Shared by {meta.hostDisplayName}
          </p>
        </header>
        <main style={{ padding: 24, flex: 1 }}>
          {frameEntries.length === 0 ? (
            <EmptyState
              status={status}
              hostName={meta.hostDisplayName}
              projectSlug={meta.projectSlug}
            />
          ) : (
            frameEntries.map(([path, content]) => (
              <section key={path} style={{ marginBottom: 32 }}>
                <h3
                  style={{
                    margin: "0 0 8px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--fg-neutral-subtle, #6a5a7d)",
                  }}
                >
                  {path}
                </h3>
                <iframe
                  title={path}
                  srcDoc={content}
                  style={{
                    width: "100%",
                    height: 560,
                    border: "1px solid var(--stroke-neutral-subtle, #e5e0db)",
                    borderRadius: 8,
                    background: "#fff",
                  }}
                />
              </section>
            ))
          )}
        </main>
      </div>
      <aside
        style={{
          borderLeft: "1px solid var(--stroke-neutral-subtle, #e5e0db)",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          background: "var(--surface-shallow, #fff)",
        }}
      >
        <div
          style={{
            padding: "16px 16px 8px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--fg-neutral-prominent, #211e20)",
          }}
        >
          Comments
        </div>
        <div style={{ overflow: "auto", padding: "0 16px 16px" }}>
          {comments.length === 0 ? (
            <p style={{ margin: 0, color: "var(--fg-neutral-subtle, #6a5a7d)", fontSize: 13 }}>
              No comments yet. Send the first one below.
            </p>
          ) : (
            comments.map((c) => (
              <div key={c.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle, #6a5a7d)" }}>
                  {c.displayName}
                </div>
                <div style={{ fontSize: 14 }}>{c.text}</div>
              </div>
            ))
          )}
        </div>
        <CommentInput
          onSend={async (text) => {
            await fetch(`/api/shared-projects/${id}/comment`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text }),
            });
          }}
        />
      </aside>
    </div>
  );
}

function EmptyState({
  status,
  hostName,
  projectSlug,
}: {
  status: "online" | "offline" | "unknown";
  hostName: string;
  projectSlug: string;
}) {
  const headline =
    status === "offline"
      ? `No frames yet — ${hostName} hasn't generated any in “${projectSlug}”`
      : status === "online"
        ? `${hostName} is online. Frames will appear here as they're generated.`
        : "Connecting to the host…";
  const subtext =
    status === "offline"
      ? "Frames will sync the next time the host opens Studio. You can leave a comment below — it'll be delivered when they're back."
      : status === "online"
        ? "If the host has frames already, they'll show up shortly via cache replay."
        : "If this takes more than a few seconds, the host may be offline.";
  return (
    <div
      style={{
        border: "1px dashed var(--stroke-neutral-subtle, #d5cec6)",
        borderRadius: 12,
        padding: 32,
        textAlign: "center",
        color: "var(--fg-neutral-subtle, #6a5a7d)",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: "var(--fg-neutral-prominent, #211e20)",
          marginBottom: 6,
        }}
      >
        {headline}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{subtext}</div>
    </div>
  );
}
