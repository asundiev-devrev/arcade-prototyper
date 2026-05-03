import { useState, useEffect } from "react";
import { IconButton, Tooltip } from "@xorkavi/arcade-gen";
import { ShareModal } from "./ShareModal";
import type { Project } from "../../../server/types";

function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

interface ShareButtonProps {
  project?: Project;
}

export function ShareButton({ project }: ShareButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [vercelConfigured, setVercelConfigured] = useState(false);

  useEffect(() => {
    async function checkVercelConfig() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const settings = await res.json();
          setVercelConfigured(!!settings.vercel?.token);
        }
      } catch {
        setVercelConfigured(false);
      }
    }
    void checkVercelConfig();
  }, []);

  const hasFrames = project && project.frames.length > 0;
  const disabled = !hasFrames || !vercelConfigured;

  const tooltipContent = !vercelConfigured
    ? "Configure Vercel token in Settings"
    : !hasFrames
    ? "No frames to share"
    : "Share frame to Vercel";

  return (
    <>
      <Tooltip content={tooltipContent}>
        <IconButton
          aria-label="Share"
          variant="tertiary"
          disabled={disabled}
          onClick={() => setShowModal(true)}
        >
          <ShareIcon />
        </IconButton>
      </Tooltip>

      {showModal && project && (
        <ShareModal
          open={showModal}
          onClose={() => setShowModal(false)}
          projectSlug={project.slug}
          frames={project.frames}
        />
      )}
    </>
  );
}
