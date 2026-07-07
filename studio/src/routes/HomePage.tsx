import { useState, useRef } from "react";
import { useToast } from "@xorkavi/arcade-gen";
import { useProjects } from "../hooks/useProjects";
import { api } from "../lib/api";
import { deriveProjectName } from "../lib/deriveProjectName";
import { setPendingPrompt } from "../lib/pendingPrompt";
import { StudioHeader } from "../components/shell/StudioHeader";
import { AppSettingsButton } from "../components/shell/SettingsButton";
import { StudioBrand } from "../components/shell/StudioBrand";
import { HeroPromptInput, type HeroPromptSubmitArgs } from "../components/home/HeroPromptInput";
import wedgeTrUrl from "../assets/brand/wedge-tr.svg";
import wedgeBlUrl from "../assets/brand/wedge-bl.svg";
import { HomeShelf } from "../components/home/HomeShelf";
import { useDialogs } from "../components/feedback/Dialogs";
import type { Project } from "../../server/types";

export function HomePage({ onOpen }: { onOpen: (slug: string) => void }) {
  const { projects, refresh } = useProjects();
  const { toast } = useToast();
  const { confirm, promptText } = useDialogs();
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleHeroSubmit(args: HeroPromptSubmitArgs) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const name = deriveProjectName(args.prompt);
      const project = await api.createProject({
        name,
        theme: "arcade",
        mode: "light",
      });

      setPendingPrompt(project.slug, {
        prompt: args.prompt,
        imagePaths: args.imagePaths,
        figmaUrl: args.figmaUrl,
      });

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
    const next = await promptText({
      title: "Rename project",
      defaultValue: p.name,
      confirmLabel: "Rename",
    });
    if (!next) return;
    try {
      await api.renameProject(p.slug, next);
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
    const ok = await confirm({
      title: `Delete "${p.name}"?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
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

  async function handleTemplateStart(templateId: string) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const names: Record<string, string> = { computer: "Computer: Chat", "computer-settings": "Computer: Settings", "builder-page": "Agent Studio: Builder" };
      const base = names[templateId] ?? "Untitled";
      // Dedupe the DISPLAY name against existing projects (createProject only
      // dedupes the slug): "Computer: Chat", then "Computer: Chat 2", …
      const taken = new Set(projects.map((p) => p.name));
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
      const project = await api.createProject({
        name,
        theme: "arcade",
        mode: "light",
      });
      await api.seedTemplate(project.slug, templateId);
      void refresh();
      onOpen(project.slug);
    } catch (e) {
      toast({
        title: "Failed to start from template",
        description: e instanceof Error ? e.message : String(e),
        intent: "alert",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImportClick() {
    const ok = await confirm({
      title: "Import a project?",
      description: "Only import .arcade files from people you trust. They contain code that runs on your machine.",
      confirmLabel: "Choose file…",
    });
    if (ok) fileRef.current?.click();
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    try {
      const project = await api.importProject(file);
      void refresh();
      onOpen(project.slug);
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : String(err), intent: "alert" });
    }
  }

  return (
    <div
      className="studio-canvas-bg"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        ["--studio-wedge-tr" as any]: `url(${wedgeTrUrl})`,
        ["--studio-wedge-bl" as any]: `url(${wedgeBlUrl})`,
      }}
    >
      <StudioHeader title={<StudioBrand />} right={<AppSettingsButton />} />
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
          <input ref={fileRef} type="file" accept=".arcade" style={{ display: "none" }} onChange={handleFilePicked} />
          <HomeShelf
            projects={projects}
            onOpen={onOpen}
            onRename={handleRename}
            onDelete={handleDelete}
            onStartTemplate={handleTemplateStart}
            onImport={handleImportClick}
          />
        </div>
      </div>
    </div>
  );
}
