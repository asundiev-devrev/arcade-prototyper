import React from "react";
import { ButtonGroup, Button } from "../arcade-components";

export default (
  <ButtonGroup role="group" aria-label="Save options">
    <Button variant="primary">Save</Button>
    <Button variant="secondary">Save as draft</Button>
    <Button variant="secondary">Discard</Button>
  </ButtonGroup>
);
