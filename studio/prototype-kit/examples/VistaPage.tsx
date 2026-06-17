import React from "react";
import { VistaPage } from "../templates/VistaPage.js";
import { NavSidebar } from "../composites/NavSidebar.js";
import { VistaHeader } from "../composites/VistaHeader.js";
import { VistaGroupRail } from "../composites/VistaGroupRail.js";
import { VistaRow } from "../composites/VistaRow.js";
import {
  MagnifyingGlass,
  ArrowsUpAndDown,
  PlusSmall,
} from "../arcade-components";

export default (
  <div className="h-[720px] w-[1200px]">
    <VistaPage
      sidebar={<NavSidebar />}
      title="All issues"
      count="16,538"
      tabs={
        <VistaPage.Tabs>
          <VistaPage.Tab active>Issues</VistaPage.Tab>
          <VistaPage.Tab>Closed</VistaPage.Tab>
        </VistaPage.Tabs>
      }
      actions={
        <>
          <VistaHeader.Action icon={<MagnifyingGlass />} label="Search" />
          <VistaHeader.Action icon={<ArrowsUpAndDown />} label="Sort" />
        </>
      }
      primaryAction={
        <VistaHeader.PrimaryAction icon={<PlusSmall />}>Issue</VistaHeader.PrimaryAction>
      }
    >
      <VistaGroupRail
        sortControl={
          <span className="text-body-small text-(--fg-neutral-subtle)">Sort by Default</span>
        }
      >
        <VistaGroupRail.Item label="P0" count={1} selected />
        <VistaGroupRail.Item label="P1" count={15} />
        <VistaGroupRail.Item label="P2" count={13} />
      </VistaGroupRail>
      <div className="flex-1 min-w-0 overflow-auto">
        <VistaRow.Header>
          <VistaRow.HeaderCell className="w-24">ID</VistaRow.HeaderCell>
          <VistaRow.HeaderCell className="flex-1 min-w-0">Title</VistaRow.HeaderCell>
          <VistaRow.HeaderCell className="w-40">Owner</VistaRow.HeaderCell>
          <VistaRow.HeaderCell className="w-40">Stage</VistaRow.HeaderCell>
        </VistaRow.Header>
        <VistaRow>
          <VistaRow.Id>ENH-7267</VistaRow.Id>
          <VistaRow.Title>Single sign-on for enterprise accounts</VistaRow.Title>
          <VistaRow.Owner name="Priya Shah" />
          <VistaRow.Stage>In development</VistaRow.Stage>
        </VistaRow>
        <VistaRow>
          <VistaRow.Id intent="info">ISS-4410</VistaRow.Id>
          <VistaRow.Title>Webhook retries drop after 24 hours</VistaRow.Title>
          <VistaRow.Owner name="Marcus Lee" />
          <VistaRow.Stage>Triage</VistaRow.Stage>
        </VistaRow>
      </div>
    </VistaPage>
  </div>
);
