import React from "react";
import { Radio } from "../arcade-components";

export default (
  <Radio.Group defaultValue="email" aria-label="Notification preference">
    <Radio.Item value="email" label="Email" />
    <Radio.Item value="sms" label="SMS" />
    <Radio.Item value="push" label="Push notification" />
  </Radio.Group>
);
