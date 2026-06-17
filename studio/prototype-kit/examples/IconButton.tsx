import React from "react";
import { IconButton, MagnifyingGlass, Pencil, TrashBin } from "../arcade-components";

export default (
  <div className="flex items-center gap-2">
    <IconButton aria-label="Search" variant="secondary">
      <MagnifyingGlass />
    </IconButton>
    <IconButton aria-label="Edit" variant="tertiary">
      <Pencil />
    </IconButton>
    <IconButton aria-label="Delete" variant="destructive">
      <TrashBin />
    </IconButton>
  </div>
);
