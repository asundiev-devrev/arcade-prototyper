import { useEffect, useState } from "react";
import { CommentInput } from "../components/multiplayer/CommentInput";
import { OfflineBanner } from "../components/multiplayer/OfflineBanner";

interface Mirror {
  id: string;
  hostDisplayName: string;
  projectSlug: string;
  lastSeenAt: string;
}
interface ChatEvent {
  type?: string;
  [k: string]: unknown;
}

export default function SharedProject({ id }: { id: string }) {
  const [meta, setMeta] = useState<Mirror | null>(null);
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [chat, setChat] = useState<ChatEvent[]>([]);
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

  const sendComment = async (text: string) => {
    await fetch(`/api/shared-projects/${id}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  };

  if (!meta) return <div style={{ padding: 24 }}>Loading shared project…</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: "100vh" }}>
      <div style={{ overflow: "auto" }}>
        {status === "offline" && <OfflineBanner hostName={meta.hostDisplayName} />}
        <header style={{ padding: 16, borderBottom: "1px solid #eee" }}>
          <h1>{meta.projectSlug}</h1>
          <p style={{ color: "#6a5a7d" }}>Shared by {meta.hostDisplayName}</p>
        </header>
        <main style={{ padding: 16 }}>
          {Object.entries(frames).map(([path, content]) => (
            <div key={path} style={{ marginBottom: 24 }}>
              <h3>{path}</h3>
              <iframe
                title={path}
                srcDoc={content}
                style={{ width: "100%", height: 480, border: "1px solid #eee" }}
              />
            </div>
          ))}
        </main>
      </div>
      <aside style={{ borderLeft: "1px solid #eee", display: "grid", gridTemplateRows: "1fr auto" }}>
        <div style={{ overflow: "auto", padding: 12 }}>
          {chat.map((c, i) => (
            <div key={i} style={{ marginBottom: 8, fontSize: 13 }}>
              <strong>{(c as { type?: string }).type}:</strong> {JSON.stringify(c)}
            </div>
          ))}
        </div>
        <CommentInput onSend={sendComment} />
      </aside>
    </div>
  );
}
