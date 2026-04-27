import { useState } from "react";
import { Modal, Input, Button, Select } from "@xorkavi/arcade-gen";
import { api } from "../../lib/api";

export function NewProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState("");
  const [theme, setTheme] = useState<"arcade" | "devrev-app">("arcade");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.createProject({ name: name.trim(), theme, mode: "light" });
      setName("");
      onCreated(p.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) {
      setError(null);
      onClose();
    }
  }

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>New project</Modal.Title>
          <Modal.Description>Create a new arcade-studio project.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="grid gap-3">
            <Input
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              autoFocus
              disabled={busy}
            />
            <Select.Root
              value={theme}
              onValueChange={(v) => setTheme(v as "arcade" | "devrev-app")}
              disabled={busy}
            >
              <Select.Trigger aria-label="Theme">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="arcade">Arcade theme</Select.Item>
                <Select.Item value="devrev-app">DevRev App theme</Select.Item>
              </Select.Content>
            </Select.Root>
            {error && (
              <div style={{ color: "var(--fg-danger-prominent)", fontSize: 12 }}>
                {error}
              </div>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
