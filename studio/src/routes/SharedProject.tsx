import { useEffect, useState } from "react";

interface MirrorMetadata {
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
  const [meta, setMeta] = useState<MirrorMetadata | null>(null);
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [chat, setChat] = useState<ChatEvent[]>([]);
  const [status, setStatus] = useState<"online" | "offline" | "unknown">("unknown");

  useEffect(() => {
    fetch(`/api/shared-projects/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setMeta(data.metadata);
        setFrames(data.frames ?? {});
        setChat(data.chat ?? []);
      })
      .catch((err) => console.warn("shared project fetch failed:", err));

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

  if (!meta) return <div style={{ padding: 24 }}>Loading shared project…</div>;

  return (
    <div style={{ padding: 24 }}>
      <h1>{meta.projectSlug}</h1>
      <p>Shared by {meta.hostDisplayName}</p>
      {status === "offline" && <div>Host is offline — viewing cached state</div>}
      <pre>{Object.keys(frames).length} frame(s) cached</pre>
      <pre>{chat.length} chat event(s) loaded</pre>
    </div>
  );
}
