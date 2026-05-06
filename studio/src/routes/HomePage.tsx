import { useState } from "react";
import { useToast } from "@xorkavi/arcade-gen";
import { useProjects } from "../hooks/useProjects";
import { api } from "../lib/api";
import { deriveProjectName } from "../lib/deriveProjectName";
import { decoratePromptWithFigma } from "../lib/figmaUrl";
import { StudioHeader } from "../components/shell/StudioHeader";
import { AppSettingsButton } from "../components/shell/SettingsButton";
import { HeroPromptInput, type HeroPromptSubmitArgs } from "../components/home/HeroPromptInput";
import { ProjectsSection } from "../components/home/ProjectsSection";
import type { Project } from "../../server/types";

export function HomePage({ onOpen }: { onOpen: (slug: string) => void }) {
  const { projects, refresh } = useProjects();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  async function handleHeroSubmit(args: HeroPromptSubmitArgs) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const name = deriveProjectName(args.prompt);
      const project = await api.createProject({ name, theme: "arcade", mode: "light" });

      let imagePaths = args.imagePaths;
      if (imagePaths.length > 0) {
        const adoption = await api.adoptUploads(project.slug, imagePaths);
        imagePaths = imagePaths.map((old) => adoption.mapping[old] ?? old);
        if (adoption.missing.length > 0) {
          toast({
            title: `Couldn't attach ${adoption.missing.length} image${adoption.missing.length === 1 ? "" : "s"}`,
            intent: "alert",
          });
        }
      }

      // Start the chat turn server-side before navigating so ProjectDetail's
      // stream subscription latches onto the same turn (including any events
      // emitted before it mounts). This is the fix for "new project shows
      // my prompt but no streaming" — the turn is guaranteed to exist in
      // the registry by the time /api/chat/stream/:slug is hit.
      const decorated = args.figmaUrl
        ? decoratePromptWithFigma(args.prompt, args.figmaUrl)
        : args.prompt;
      try {
        await api.startChatTurn(project.slug, decorated, imagePaths);
      } catch (startErr) {
        // A failure here (e.g. 409 turn_in_progress for a stale project)
        // shouldn't block navigation — the user still sees their project
        // and can retry from the chat pane. Surface a toast instead of
        // throwing so the project still opens.
        toast({
          title: "Couldn't start the first turn",
          description:
            startErr instanceof Error ? startErr.message : String(startErr),
          intent: "alert",
        });
      }

      void refresh();
      onOpen(project.slug);
    } catch (e) {
      toast({
        title: "Failed to create project",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRename(p: Project) {
    const next = prompt("New name", p.name);
    if (!next || !next.trim()) return;
    try {
      await api.renameProject(p.slug, next.trim());
      void refresh();
      toast({ title: "Project renamed", intent: "success" });
    } catch (e) {
      toast({
        title: "Rename failed",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    }
  }

  async function handleDelete(p: Project) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteProject(p.slug);
      void refresh();
      toast({ title: "Project deleted", intent: "success" });
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <StudioHeader title="Studio" right={<AppSettingsButton />} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div
          style={{
            maxWidth: 800,
            margin: "0 auto",
            padding: "120px 24px 48px",
            display: "flex",
            flexDirection: "column",
            gap: 160,
          }}
        >
          <HeroPromptInput onSubmit={handleHeroSubmit} disabled={submitting} />
          <ProjectsSection
            projects={projects}
            onOpen={onOpen}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </div>
      </div>
    </div>
  );
}
