import React from "react";
import { CardGrid } from "../composites/CardGrid.js";
import { EntityCard } from "../composites/EntityCard.js";

export default (
  <CardGrid columns={2}>
    <EntityCard title="Onboarding" description="12 steps" status="Active" />
    <EntityCard title="Billing" description="3 plans" status="Live" />
    <EntityCard title="Team" description="8 members" />
    <EntityCard title="Settings" description="Workspace config" />
  </CardGrid>
);
