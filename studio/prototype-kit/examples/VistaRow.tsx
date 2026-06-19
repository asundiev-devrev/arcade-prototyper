import React from "react";
import { VistaRow } from "../composites/VistaRow.js";

export default (
  <div className="w-[900px] bg-(--surface-overlay)">
    <VistaRow.Header>
      <VistaRow.HeaderCell className="w-6" />
      <VistaRow.HeaderCell className="w-24">ID</VistaRow.HeaderCell>
      <VistaRow.HeaderCell className="flex-1 min-w-0">Title</VistaRow.HeaderCell>
      <VistaRow.HeaderCell className="w-40">Owner</VistaRow.HeaderCell>
      <VistaRow.HeaderCell className="w-40" sortable>
        Stage
      </VistaRow.HeaderCell>
      <VistaRow.HeaderCell className="w-28">Updated</VistaRow.HeaderCell>
    </VistaRow.Header>
    <VistaRow>
      <VistaRow.Select defaultChecked />
      <VistaRow.Id>ENH-7267</VistaRow.Id>
      <VistaRow.Title>Single sign-on for enterprise accounts</VistaRow.Title>
      <VistaRow.Owner name="Priya Shah" />
      <VistaRow.Stage>In development</VistaRow.Stage>
      <VistaRow.Updated>May 27, 2026</VistaRow.Updated>
    </VistaRow>
    <VistaRow>
      <VistaRow.Select />
      <VistaRow.Id intent="info">ISS-4410</VistaRow.Id>
      <VistaRow.Title>Webhook retries drop after 24 hours</VistaRow.Title>
      <VistaRow.Owner name="Marcus Lee" />
      <VistaRow.Stage>Triage</VistaRow.Stage>
      <VistaRow.Updated>May 31, 2026</VistaRow.Updated>
    </VistaRow>
  </div>
);
