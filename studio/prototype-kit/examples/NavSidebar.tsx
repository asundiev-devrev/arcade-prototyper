import React from "react";
import { NavSidebar } from "../composites/NavSidebar.js";

// NavSidebar with no children renders the full canonical DevRev nav
// (Work / Teams / Views + Explore) — the standard, design-matching default.
export default (
  <div className="h-[560px] flex bg-(--surface-overlay)">
    <div className="w-60">
      <NavSidebar />
    </div>
  </div>
);
