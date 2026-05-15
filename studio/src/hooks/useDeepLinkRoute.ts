import { useEffect, useState } from "react";

export type DeepLinkRoute =
  | { kind: "session"; sessionId: string; relayUrl: string }
  | {
      kind: "project";
      projectShareId: string;
      relayUrl: string;
      hostDevu: string;
      hostDisplayName: string;
      projectSlug: string;
    };

export function parseDeepLink(href: string): DeepLinkRoute | null {
  const hashIdx = href.indexOf("#");
  if (hashIdx === -1) return null;
  const hash = href.slice(hashIdx + 1);
  const params = new URLSearchParams(hash);
  const encoded = params.get("share") ?? params.get("join");
  if (!encoded) return null;

  let inner: URL;
  try {
    inner = new URL(encoded);
  } catch {
    return null;
  }
  if (inner.protocol !== "arcade-studio:") return null;

  const relay = inner.searchParams.get("relay") ?? "";
  const kind = inner.host;
  const id = inner.pathname.replace(/^\//, "");

  if (kind === "session") {
    if (!id || !relay) return null;
    return { kind: "session", sessionId: id, relayUrl: relay };
  }
  if (kind === "project") {
    const hostDevu = inner.searchParams.get("host") ?? "";
    const hostDisplayName = inner.searchParams.get("hostName") ?? "";
    const projectSlug = inner.searchParams.get("projectSlug") ?? "";
    if (!id || !relay) return null;
    return {
      kind: "project",
      projectShareId: id,
      relayUrl: relay,
      hostDevu,
      hostDisplayName,
      projectSlug,
    };
  }
  return null;
}

export function clearDeepLink(): void {
  if (typeof window === "undefined") return;
  if (!window.location.hash) return;
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

export function useDeepLinkRoute(): DeepLinkRoute | null {
  const [route, setRoute] = useState<DeepLinkRoute | null>(() =>
    typeof window === "undefined" ? null : parseDeepLink(window.location.href),
  );

  useEffect(() => {
    function onHashChange() {
      setRoute(parseDeepLink(window.location.href));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}
