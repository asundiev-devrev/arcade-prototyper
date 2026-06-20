import React from "react";
import { CapabilitySection } from "../composites/CapabilitySection.js";
import { EntityCard } from "../composites/EntityCard.js";
import { Button, Book } from "../arcade-components";

export default (
  <CapabilitySection
    icon={<Book size={20} />}
    title="Knowledge"
    description="Add sources your agent can reference."
    action={<Button variant="tertiary">+ Add</Button>}
  >
    <EntityCard title="Help Center" description="312 articles" />
    <EntityCard title="Product docs" description="48 pages" />
  </CapabilitySection>
);
