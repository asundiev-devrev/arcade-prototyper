import { AppShell, TitleBar, BreadcrumbBar, PageBody } from "arcade-prototypes";
import { Tabs, Button } from "arcade";

export default function TicketDetail() {
  return (
    <AppShell sidebar={<div />}>
      <TitleBar title="TKT-42" />
      <BreadcrumbBar />
      <PageBody>
        <Tabs value="overview" onChange={() => {}} />
        <Button>Resolve</Button>
      </PageBody>
    </AppShell>
  );
}
