import React from "react";
import { BreadcrumbBar } from "../composites/BreadcrumbBar.js";
import { Breadcrumb, Button } from "../arcade-components";

export default (
  <BreadcrumbBar
    breadcrumb={
      <Breadcrumb.Root>
        <Breadcrumb.Item>
          <Breadcrumb.Link href="#">Workspace</Breadcrumb.Link>
        </Breadcrumb.Item>
        <Breadcrumb.Separator />
        <Breadcrumb.Item>
          <Breadcrumb.Link href="#">Settings</Breadcrumb.Link>
        </Breadcrumb.Item>
        <Breadcrumb.Separator />
        <Breadcrumb.Item current>
          <Breadcrumb.Link href="#">Members</Breadcrumb.Link>
        </Breadcrumb.Item>
      </Breadcrumb.Root>
    }
    actions={<Button variant="primary">Save</Button>}
  />
);
