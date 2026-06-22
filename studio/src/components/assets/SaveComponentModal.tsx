import { useState, useRef, useEffect } from "react";
import { Modal, Button, Input, IconButton, CrossSmall } from "@xorkavi/arcade-gen";
import type { TargetSelection } from "../../hooks/targetSelectionContext";

interface SaveComponentModalProps {
  target: TargetSelection;
  projectSlug: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}

const NAME_PATTERN = /^[A-Z][A-Za-z0-9]{1,39}$/;

export function SaveComponentModal({
  target,
  projectSlug,
  onClose,
  onSaved,
}: SaveComponentModalProps) {
  const [name, setName] = useState(target.componentName || target.tagName || "");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReplace, setShowReplace] = useState(false);

  // Use ref to ensure handleSave always sees the latest name value
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  const isValidName = NAME_PATTERN.test(name);

  function handleSave(replace = false) {
    // Re-check validation here using ref to avoid stale closure issues
    if (!NAME_PATTERN.test(nameRef.current)) {
      setError("Name must be PascalCase: start with uppercase letter, contain only letters and numbers, 2-40 characters");
      return;
    }

    setBusy(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch("/api/components/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug,
          frameSlug: target.frameSlug,
          line: target.line,
          column: target.column,
          name: nameRef.current,
          description,
          ...(replace ? { replace: true } : {}),
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        // Name taken — show replace option
        setShowReplace(true);
        setError("A component with this name already exists.");
        setBusy(false);
        return;
      }

      if (res.status === 422) {
        // Extract failed
        setError(data.error?.message || "Failed to extract component");
        setBusy(false);
        return;
      }

      if (res.status === 400) {
        // Bad name
        setError(data.error?.message || "Invalid component name");
        setBusy(false);
        return;
      }

      if (!res.ok) {
        setError(data.error?.message || `Save failed: ${res.status}`);
        setBusy(false);
        return;
      }

        // Success
        onSaved(data.name);
      } catch (err: any) {
        setError(err.message || "Failed to save component");
        setBusy(false);
      }
    })();
  }

  return (
    <Modal.Root open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Save as Component</Modal.Title>
          <Modal.Description>
            Extract this element as a reusable component
          </Modal.Description>
          <Modal.Close asChild>
            <IconButton
              aria-label="Close"
              variant="tertiary"
              size="sm"
              style={{ position: "absolute", top: 16, right: 16 }}
            >
              <CrossSmall />
            </IconButton>
          </Modal.Close>
        </Modal.Header>

        <Modal.Body>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label
                htmlFor="component-name"
                style={{ fontSize: 13, fontWeight: 540, color: "var(--fg-neutral-prominent)" }}
              >
                Name
              </label>
              <Input
                id="component-name"
                value={name}
                onChange={(e) => {
                  const newName = e.target.value;
                  setName(newName);
                  nameRef.current = newName; // Update ref immediately for validation
                  setError(null);
                  setShowReplace(false);
                }}
                placeholder="ComponentName"
                disabled={busy}
                autoFocus
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label
                htmlFor="component-description"
                style={{ fontSize: 13, fontWeight: 540, color: "var(--fg-neutral-prominent)" }}
              >
                Description (optional)
              </label>
              <Input
                id="component-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this component"
                disabled={busy}
              />
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--bg-alert-subtle)",
                  color: "var(--fg-alert-prominent)",
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          {showReplace ? (
            <Button
              variant="primary"
              onClick={() => handleSave(true)}
              disabled={busy || !isValidName}
            >
              {busy ? "Replacing…" : "Replace"}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => handleSave(false)}
              disabled={busy || !isValidName}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
