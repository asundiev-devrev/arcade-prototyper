import React from "react";
import { CanvasPanel } from "../composites/CanvasPanel.js";
import { Document, Globe } from "../arcade-components";

export default (
  <CanvasPanel
    step={
      <CanvasPanel.Step
        current={2}
        total={4}
        title="Gather recent projects and form an agenda"
      />
    }
  >
    <CanvasPanel.Group title="Created in this topic">
      <CanvasPanel.Item leading={<CanvasPanel.FileIcon />} trailing={<CanvasPanel.StatusDot />}>
        Outline draft.md
      </CanvasPanel.Item>
      <CanvasPanel.Item leading={<CanvasPanel.FileIcon />}>
        Talking points.md
      </CanvasPanel.Item>
    </CanvasPanel.Group>

    <CanvasPanel.Group title="On Ava's Macbook" trailing={<CanvasPanel.GroupAddButton />}>
      <CanvasPanel.Item leading={<CanvasPanel.FolderIcon />}>Q3 launch</CanvasPanel.Item>
      <CanvasPanel.Item leading={<CanvasPanel.FolderIcon />}>Brand assets</CanvasPanel.Item>
    </CanvasPanel.Group>

    <CanvasPanel.Group title="Sources (2)">
      <CanvasPanel.Item leading={<Document size={16} />} trailing={<CanvasPanel.CountBadge>12</CanvasPanel.CountBadge>}>
        Notion
      </CanvasPanel.Item>
      <CanvasPanel.Item leading={<Globe size={16} />} trailing={<CanvasPanel.CountBadge>20</CanvasPanel.CountBadge>}>
        Gmail
      </CanvasPanel.Item>
    </CanvasPanel.Group>
  </CanvasPanel>
);
