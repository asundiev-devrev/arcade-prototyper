import React from "react";
import { DetailModal } from "../composites/DetailModal.js";
import { Button, PlusSmall } from "../arcade-components";

export default (
  <DetailModal
    open
    hero={<div className="h-full w-full bg-gradient-to-br from-(--surface-shallow) to-(--bg-neutral-subtle)" />}
    title="List outstanding items"
    byline="Extracts all open action items from a conversation and turns them into a checklist."
    action={
      <Button variant="primary">
        <span className="inline-flex items-center gap-1.5">
          <PlusSmall size={16} />
          Add to Computer
        </span>
      </Button>
    }
  >
    <div className="flex flex-col gap-2">
      <h3 className="text-body-medium-bold text-(--fg-neutral-prominent)">Instructions</h3>
      <p className="text-body text-(--fg-neutral-subtle)">
        You are a professional assistant. Review the conversation and list every
        outstanding task with an owner and a due date.
      </p>
    </div>
  </DetailModal>
);
