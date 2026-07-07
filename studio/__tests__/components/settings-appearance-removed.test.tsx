import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// Minimal arcade-gen mock covering what AppSettingsModal imports.
vi.mock("@xorkavi/arcade-gen", async () => {
  const R = await import("react");
  const passthrough = (tag: string) => ({ children, ...p }: any) => R.createElement(tag, p, children);
  const Modal: any = passthrough("div");
  Modal.Root = ({ children }: any) => R.createElement("div", null, children);
  Modal.Content = passthrough("div");
  Modal.Header = passthrough("div");
  Modal.Title = passthrough("div");
  Modal.Description = passthrough("div");
  Modal.Body = passthrough("div");
  Modal.Footer = passthrough("div");
  const Select: any = ({ children }: any) => R.createElement("div", null, children);
  Select.Root = ({ children }: any) => R.createElement("div", null, children);
  Select.Trigger = passthrough("div");
  Select.Value = passthrough("div");
  Select.Content = passthrough("div");
  Select.Item = passthrough("div");
  return {
    Modal, Select,
    Button: passthrough("button"),
    IconButton: R.forwardRef((p: any, ref: any) => R.createElement("button", { ...p, ref })),
    Input: R.forwardRef((p: any, ref: any) => R.createElement("input", { ...p, ref })),
    Switch: (p: any) => R.createElement("input", { type: "checkbox", ...p }),
    Badge: passthrough("span"),
  };
});
vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as Response)));

import { AppSettingsModal } from "../../src/components/shell/AppSettingsModal";

afterEach(() => cleanup());

describe("AppSettingsModal appearance section", () => {
  it("no longer renders a dark-mode / appearance toggle", () => {
    render(<AppSettingsModal open onClose={() => {}} />);
    expect(screen.queryByText(/dark mode/i)).toBeNull();
    expect(screen.queryByText(/appearance/i)).toBeNull();
  });
});
