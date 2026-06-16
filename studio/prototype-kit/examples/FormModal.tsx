import React from "react";
import { FormModal } from "../composites/FormModal.js";
import { FormField } from "../composites/FormField.js";
import { Input } from "../arcade-components";

export default (
  <FormModal open title="Edit profile" subtitle="Update your account details" submitLabel="Save">
    <FormField label="Name">
      <Input defaultValue="Ada Lovelace" />
    </FormField>
    <FormField label="Email">
      <Input defaultValue="ada@example.com" />
    </FormField>
  </FormModal>
);
