import React from "react";
import { FormField } from "../composites/FormField.js";
import { Input } from "../arcade-components";

export default (
  <FormField label="Workspace name" required>
    <Input defaultValue="Acme" />
  </FormField>
);
