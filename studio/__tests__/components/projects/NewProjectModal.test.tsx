import { describe, it, expect, vi } from "vitest";

// The real @xorkavi/arcade-gen barrel pulls in Dashboard → gridstack, which has
// a broken extensionless subpath import incompatible with Node ESM under vitest.
// Stub the primitives NewProjectModal uses so the test exercises only its logic.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    ({ children, ...rest }: any) => React.createElement(tag, rest, children);
  const Modal: any = {
    Root: ({ open, children }: any) => (open ? React.createElement("div", null, children) : null),
    Content: passthrough("div"),
    Header: passthrough("div"),
    Body: passthrough("div"),
    Footer: passthrough("div"),
    Title: passthrough("h2"),
    Description: passthrough("p"),
  };
  const Input = (props: any) => React.createElement("input", props);
  const Button = ({ children, disabled, onClick }: any) =>
    React.createElement("button", { disabled, onClick }, children);
  const Select: any = {
    Root: ({ children }: any) => React.createElement("div", null, children),
    Trigger: passthrough("span"),
    Value: () => React.createElement("span"),
    Content: passthrough("div"),
    Item: ({ value, children }: any) => React.createElement("div", { "data-value": value }, children),
  };
  return { Modal, Input, Button, Select };
});

import { render, screen, fireEvent } from "@testing-library/react";
import { NewProjectModal } from "../../../src/components/projects/NewProjectModal";

vi.mock("../../../src/lib/api", () => ({
  api: { createProject: vi.fn(async ({ name }) => ({ slug: name.toLowerCase() })) },
}));

describe("NewProjectModal", () => {
  it("enables create only with a name", () => {
    render(<NewProjectModal open onClose={() => {}} onCreated={() => {}} />);
    const create = screen.getByRole("button", { name: /create/i });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/project name/i), { target: { value: "X" } });
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });
});
