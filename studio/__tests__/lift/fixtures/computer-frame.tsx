import { ComputerHeader, ComputerSidebar, ChatInput } from "arcade-prototypes";
import { Button } from "arcade";

export default function ComputerFrame() {
  return (
    <div>
      <ComputerHeader title="Workspace" />
      <ComputerSidebar />
      <ChatInput onSend={() => {}} />
      <Button>Send</Button>
    </div>
  );
}
