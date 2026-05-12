import * as React from "react";
import { Button, Modal, Input } from "arcade/components";
import { CrossSmall } from "arcade/components";

export default function DeleteConfirmation() {
  return (
    <Modal open onOpenChange={() => {}}>
      <div className="flex items-center justify-between">
        <span>Delete ticket?</span>
        <button aria-label="Close">
          <CrossSmall size={16} />
        </button>
      </div>
      <Input placeholder="Type DELETE to confirm" />
      <div className="flex gap-2">
        <Button variant="tertiary">Cancel</Button>
        <Button variant="destructive">Delete</Button>
      </div>
    </Modal>
  );
}
