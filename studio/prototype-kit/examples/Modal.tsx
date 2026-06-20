import React from "react";
import { Modal, Button } from "../arcade-components";

// Rendered open so the dialog shows in the thumbnail.
export default (
  <Modal.Root defaultOpen>
    <Modal.Content size="sm">
      <Modal.Header>
        <Modal.Title>Delete project</Modal.Title>
        <Modal.Description>
          This permanently removes “Onboarding flow” and all of its frames.
        </Modal.Description>
        <Modal.Close />
      </Modal.Header>
      <Modal.Footer>
        <Modal.Close asChild>
          <Button variant="secondary">Cancel</Button>
        </Modal.Close>
        <Button variant="destructive">Delete</Button>
      </Modal.Footer>
    </Modal.Content>
  </Modal.Root>
);
