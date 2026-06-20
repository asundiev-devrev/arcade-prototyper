import React from "react";
import { Breadcrumb } from "../arcade-components";

export default (
  <Breadcrumb.Root>
    <Breadcrumb.Item>
      <Breadcrumb.Link href="#">Settings</Breadcrumb.Link>
    </Breadcrumb.Item>
    <Breadcrumb.Separator />
    <Breadcrumb.Item>
      <Breadcrumb.Link href="#">Team</Breadcrumb.Link>
    </Breadcrumb.Item>
    <Breadcrumb.Separator />
    <Breadcrumb.Item current>Members</Breadcrumb.Item>
  </Breadcrumb.Root>
);
