import { useCallback, useEffect, useState } from "react";
import { DevRevThemeProvider, Toaster } from "@xorkavi/arcade-gen";
import { FrameFontProxy } from "./frame/FrameFontProxy";
import { ProjectList } from "./routes/ProjectList";
import { ProjectDetail } from "./routes/ProjectDetail";

function readSlugFromHash(): string | null {
  const match = window.location.hash.match(/^#\/project\/([a-z0-9][a-z0-9-]{0,62})$/i);
  return match ? match[1].toLowerCase() : null;
}

function writeSlugToHash(slug: string | null) {
  const target = slug ? `#/project/${slug}` : "";
  if (window.location.hash === target) return;
  if (slug) window.history.pushState(null, "", target);
  else window.history.pushState(null, "", window.location.pathname + window.location.search);
}

export function App() {
  const [openSlug, setOpenSlug] = useState<string | null>(() => readSlugFromHash());
  const [studioMode, setStudioMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        const mode = data?.studio?.mode;
        if (!cancelled && (mode === "dark" || mode === "light")) {
          setStudioMode(mode);
        }
      } catch {
        // fall back to default
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onHashChange() {
      setOpenSlug(readSlugFromHash());
    }
    function onModeChanged(e: Event) {
      const detail = (e as CustomEvent<"light" | "dark">).detail;
      if (detail === "light" || detail === "dark") setStudioMode(detail);
    }
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    window.addEventListener("arcade-studio:mode-changed", onModeChanged);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
      window.removeEventListener("arcade-studio:mode-changed", onModeChanged);
    };
  }, []);

  const openProject = useCallback((slug: string) => {
    writeSlugToHash(slug);
    setOpenSlug(slug);
  }, []);

  const closeProject = useCallback(() => {
    writeSlugToHash(null);
    setOpenSlug(null);
  }, []);

  return (
    <DevRevThemeProvider mode={studioMode}>
      <FrameFontProxy />
      {openSlug === null ? (
        <ProjectList onOpen={openProject} />
      ) : (
        <ProjectDetail
          slug={openSlug}
          onBack={closeProject}
          onOpenProject={openProject}
        />
      )}
      <Toaster />
    </DevRevThemeProvider>
  );
}
