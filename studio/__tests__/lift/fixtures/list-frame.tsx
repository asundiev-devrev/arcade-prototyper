import { VistaPage, VistaFilterPill, VistaPagination } from "arcade-prototypes";
import { Button, Input } from "arcade";

export default function TicketsFrame() {
  return (
    <VistaPage title="Tickets" primaryAction={<Button>New</Button>} filters={<VistaFilterPill label="Open" />}>
      <Input placeholder="Search" />
      <VistaPagination total={42} />
    </VistaPage>
  );
}
