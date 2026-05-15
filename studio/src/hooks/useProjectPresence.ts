import { useEffect, useState } from "react";

/**
 * Live presence for a project the caller hosts.
 *
 * Subscribes to the host-side SSE feed at
 * `/api/projects/:slug/presence-stream` (added by Plan 2b Task 21) and
 * updates state whenever a `presence_state` relay event fires. The hook
 * deliberately ignores other event types — those are handled elsewhere
 * (chat-relay mirror, frame writes, etc.).
 *
 * Returns a stable shape (`host: null`, `guests: []`) before the first
 * event arrives, so the consumer can render a strip with no flicker.
 */

interface Connection {
  devu: string;
  displayName: string;
}

export function useProjectPresence(projectSlug: string | null) {
  const [host, setHost] = useState<Connection | null>(null);
  const [guests, setGuests] = useState<Connection[]>([]);

  useEffect(() => {
    if (!projectSlug) return;
    const es = new EventSource(`/api/projects/${projectSlug}/presence-stream`);
    const onRelay = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev && ev.type === "presence_state") {
          setHost(ev.host ?? null);
          setGuests(Array.isArray(ev.guests) ? ev.guests : []);
        }
      } catch {
        // ignore malformed frames
      }
    };
    es.addEventListener("relay", onRelay as EventListener);
    return () => {
      es.removeEventListener("relay", onRelay as EventListener);
      es.close();
      setHost(null);
      setGuests([]);
    };
  }, [projectSlug]);

  return { host, guests };
}
