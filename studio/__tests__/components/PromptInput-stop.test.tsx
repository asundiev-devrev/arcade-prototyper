// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("@xorkavi/arcade-gen", async () => {
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  return {
    IconButton: passthrough("button"),
    Button: passthrough("button"),
    Tooltip: ({ children }: any) => React.createElement("div", null, children),
    useToast: () => ({ toast: () => {} }),
  };
});

// Stub the ChatInput composite so we don't pull gridstack and the rest of
// the prototype-kit render tree. The real composite renders the trailing
// slot verbatim, so a passthrough preserves the contract this test
// exercises (Send vs Stop button rendering inside `trailing`).
vi.mock("../../prototype-kit/composites/ChatInput", () => {
  const Root = ({ trailing, attachments, placeholder, value, onChange, inputRef }: any) =>
    React.createElement(
      "div",
      { "data-testid": "chat-input", "data-placeholder": placeholder, "data-value": value ?? "" },
      attachments,
      // A real controlled input so tests can type; forwards the ref the
      // component relies on for caret/mention handling.
      React.createElement("input", {
        "aria-label": "composer",
        ref: inputRef,
        value: value ?? "",
        onChange,
      }),
      trailing,
    );
  const SendButton = (props: { onClick?: () => void; disabled?: boolean }) =>
    React.createElement(
      "button",
      { type: "button", "aria-label": "Send", onClick: props.onClick, disabled: props.disabled },
      "Send",
    );
  const StopButton = (props: { onClick?: () => void }) =>
    React.createElement(
      "button",
      { type: "button", "aria-label": "Stop", onClick: props.onClick },
      "Stop",
    );
  const AddAttachmentButton = (props: { onClick?: () => void }) =>
    React.createElement("button", { type: "button", "aria-label": "Add", onClick: props.onClick });
  const ContextAttachment = () => React.createElement("div");
  const FileAttachment = () => React.createElement("div");
  return {
    ChatInput: Object.assign(Root, {
      SendButton,
      StopButton,
      AddAttachmentButton,
      ContextAttachment,
      FileAttachment,
    }),
  };
});

import { PromptInput, buildTargetPreamble } from "../../src/components/chat/PromptInput";
import type { EditedElement } from "../../src/hooks/editSessionContext";
import {
  EditSessionProvider, useEditSession,
  type ElementSelection, type StyleSnapshot,
} from "../../src/hooks/editSessionContext";

const STYLES: StyleSnapshot = {
  text: "Save", fontSize: "14px", fontWeight: "400", fontStyle: "normal",
  textAlign: "left", color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)",
  borderColor: "rgb(0, 0, 0)", paddingTop: "0px", paddingRight: "0px",
  paddingBottom: "0px", paddingLeft: "0px", marginTop: "0px", marginRight: "0px",
  marginBottom: "0px", marginLeft: "0px", gap: "0px", width: "80px", height: "32px",
  minWidth: "0px", maxWidth: "none", minHeight: "0px", maxHeight: "none",
  display: "block", flexDirection: "row", opacity: "1", borderRadius: "0px",
  appliedTokens: {},
};
function sel(editId: number, componentName: string, tagName: string): ElementSelection {
  return {
    editId, file: `/p/frames/home/index.tsx`, line: editId * 10, column: 3,
    componentName, tagName, textEditable: true, styles: STYLES, ownerChain: [],
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ users: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Seeds the edit-session batch with picked elements so the chip/preamble path
// can be exercised. `picks` is a list of [componentName, tagName] pairs.
function Seeder({ picks }: { picks: [string, string][] }) {
  const { addOrFocus } = useEditSession();
  React.useEffect(() => {
    picks.forEach(([comp, tag], i) => addOrFocus(sel(i + 1, comp, tag), "home", null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function Harness({
  picks = [],
  ...props
}: Partial<React.ComponentProps<typeof PromptInput>> & { picks?: [string, string][] }) {
  return (
    <EditSessionProvider>
      <Seeder picks={picks} />
      <PromptInput
        busy={false}
        projectSlug="alpha"
        onSend={() => {}}
        {...props}
      />
    </EditSessionProvider>
  );
}

describe("PromptInput Stop button", () => {
  it("renders the Send button when not busy", () => {
    render(<Harness busy={false} />);
    expect(screen.getByLabelText("Send")).toBeTruthy();
    expect(screen.queryByLabelText("Stop")).toBeNull();
  });

  it("renders the Stop button when busy and onStop is set", () => {
    const onStop = vi.fn();
    render(<Harness busy={true} onStop={onStop} />);
    const stop = screen.getByLabelText("Stop");
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does not render Stop when onStop is missing (e.g. spectator/comment)", () => {
    render(<Harness busy={true} />);
    expect(screen.queryByLabelText("Stop")).toBeNull();
  });
});

describe("PromptInput target chips", () => {
  it("renders one removable chip per picked element", () => {
    render(<Harness picks={[["Button", "button"], ["Card", "div"]]} />);
    // Two chips, each labelled by its tag.
    expect(screen.getByText("<button>")).toBeTruthy();
    expect(screen.getByText("<div>")).toBeTruthy();
    // Each has its own clear (×) control.
    expect(screen.getByLabelText("Clear target button")).toBeTruthy();
    expect(screen.getByLabelText("Clear target div")).toBeTruthy();
  });

  it("× removes only that element's chip", () => {
    render(<Harness picks={[["Button", "button"], ["Card", "div"]]} />);
    fireEvent.click(screen.getByLabelText("Clear target button"));
    expect(screen.queryByText("<button>")).toBeNull();
    // The other chip survives.
    expect(screen.getByText("<div>")).toBeTruthy();
  });

  it("sending with chips prepends a scoped preamble naming the elements, then clears them", async () => {
    const onSend = vi.fn((_prompt: string, _images: string[]) => {});
    render(<Harness picks={[["Button", "button"]]} onSend={onSend} />);
    // The mocked ChatInput exposes value via data-value; drive the real input.
    const input = screen.getByLabelText("composer") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "make this a primary CTA" } });
    fireEvent.click(screen.getByLabelText("Send"));

    expect(onSend).toHaveBeenCalledTimes(1);
    const [prompt] = onSend.mock.calls[0]!;
    // Preamble names the target + its frame source, and carries the typed text.
    expect(prompt).toContain("Target element");
    expect(prompt).toContain("<button>");
    expect(prompt).toContain("frames/home/index.tsx:10:3");
    expect(prompt).toContain("make this a primary CTA");
    // Selection consumed → chip gone (clearSelection runs after the awaited send).
    await waitFor(() => expect(screen.queryByText("<button>")).toBeNull());
  });

  it("sending WITHOUT chips does not add a preamble", () => {
    const onSend = vi.fn((_prompt: string, _images: string[]) => {});
    render(<Harness onSend={onSend} />);
    const input = screen.getByLabelText("composer") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSend).toHaveBeenCalledWith("hello", expect.anything());
  });
});

describe("buildTargetPreamble (in-frame vs kit split)", () => {
  const withStyles = { styles: STYLES } as unknown as EditedElement["selection"];
  function pick(file: string, componentName: string, tagName: string, line: number): EditedElement {
    return {
      selection: {
        ...withStyles, editId: line, file, line, column: 12,
        componentName, tagName, textEditable: false, ownerChain: [],
      },
      pending: {},
    };
  }

  it("in-frame element → frames/<slug>/index.tsx:line:col with edit-here instructions", () => {
    const batch = [pick("/p/frames/home/index.tsx", "Button", "button", 40)];
    const out = buildTargetPreamble(batch, "home");
    expect(out).toContain("authored in this frame's own source");
    expect(out).toContain("frames/home/index.tsx:40:12");
    expect(out).not.toContain("frames//"); // no double slash
  });

  it("kit-composite element → inline-into-frame, NO line number, NO frames// path (the bug)", () => {
    // The exact failing case: an <IconButton> from a shared kit file, whose path
    // has no /frames/ segment. The old code emitted `frames//prototype-kit/...:83:12`.
    const batch = [pick("/p/studio/prototype-kit/arcade-components.tsx", "IconButton", "button", 83)];
    const out = buildTargetPreamble(batch, "polina");
    // Never fabricate a frames/ path for kit source, and never leak the double slash.
    expect(out).not.toContain("frames//");
    expect(out).not.toContain("prototype-kit/arcade-components.tsx:83");
    // Tells the agent to inline into the frame and NOT trust kit line numbers.
    expect(out).toContain("SHARED prototype-kit component");
    expect(out).toContain("inline a local copy");
    expect(out).toContain("frames/polina/index.tsx");
    expect(out).toContain("<IconButton>");
  });

  it("mixed batch produces both sections", () => {
    const batch = [
      pick("/p/frames/home/index.tsx", "Heading", "h1", 12),
      pick("/p/studio/prototype-kit/arcade-components.tsx", "IconButton", "button", 83),
    ];
    const out = buildTargetPreamble(batch, "home");
    expect(out).toContain("authored in this frame's own source");
    expect(out).toContain("SHARED prototype-kit component");
    expect(out).not.toContain("frames//");
  });

  it("empty batch or missing slug → empty string", () => {
    expect(buildTargetPreamble([], "home")).toBe("");
    expect(buildTargetPreamble([pick("/p/frames/home/index.tsx", "X", "div", 1)], "")).toBe("");
  });
});
