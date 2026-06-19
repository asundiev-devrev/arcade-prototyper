import React from "react";
import { Accordion } from "../arcade-components";

export default (
  <div className="w-[420px]">
    <Accordion.Root type="single" defaultValue="item-1">
      <Accordion.Item value="item-1">
        <Accordion.Trigger>What is a design system?</Accordion.Trigger>
        <Accordion.Content>
          A collection of reusable components, guidelines, and tokens that keep
          interfaces consistent across a product.
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="item-2">
        <Accordion.Trigger>Why use design tokens?</Accordion.Trigger>
        <Accordion.Content>
          Tokens store values like color and spacing as variables, enabling
          consistent theming and easy updates.
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  </div>
);
