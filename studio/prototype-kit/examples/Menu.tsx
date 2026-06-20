import React from "react";
import { Menu, Button } from "../arcade-components";

// Rendered open so the menu items show in the thumbnail.
export default (
  <Menu.Root defaultOpen>
    <Menu.Trigger asChild>
      <Button variant="secondary">Actions</Button>
    </Menu.Trigger>
    <Menu.Content>
      <Menu.Label>Actions</Menu.Label>
      <Menu.Item>Rename</Menu.Item>
      <Menu.Item>Duplicate</Menu.Item>
      <Menu.Separator />
      <Menu.Item>Delete</Menu.Item>
    </Menu.Content>
  </Menu.Root>
);
