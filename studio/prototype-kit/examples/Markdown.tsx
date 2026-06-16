import React from "react";
import { Markdown } from "../composites/Markdown.js";

export default (
  <div className="w-[480px] p-4 text-body text-(--fg-neutral-prominent) bg-(--surface-overlay)">
    <Markdown>
      {`## Launch outline

Here's a tight **5-act structure** you can riff off:

1. Open on the *customer problem*
2. Frame the wedge
3. Walk through the product surface

> Hand off to a live demo, then close on commercial signal.

Run \`npm run build\` before the rehearsal.`}
    </Markdown>
  </div>
);
