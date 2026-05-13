import { useEffect, useState } from "react";

export interface DeepLinkRoute {
  sessionId: string;
  relayUrl: string;
}

const DEEP_LINK_RE = /^arcade-studio:\/\/session\/([a-zA-Z0-9-]+)(\?.*)?$/;
const HASH_PREFIX = "#join=";

export function parseDeepLink(): DeepLinkRoute | null {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const decoded = decodeURIComponent(hash.slice(HASH_PREFIX.length));
  const match = decoded.match(DEEP_LINK_RE);
  if (!match) return null;
  const sessionId = match[1];
  const query = match[2] ?? "";
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const relayUrl = params.get("relay");
  if (!relayUrl) return null;
  return { sessionId, relayUrl };
}

export function clearDeepLink(): void {
  // Strip the hash so a second mount (e.g., refresh) does not re-trigger.
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", pathname + search);
}

export function useDeepLinkRoute(): DeepLinkRoute | null {
  const [route, setRoute] = useState<DeepLinkRoute | null>(() => parseDeepLink());

  useEffect(() => {
    function onHashChange() {
      setRoute(parseDeepLink());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}
