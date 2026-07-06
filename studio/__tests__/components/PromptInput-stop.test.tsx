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

describe("buildTargetPreamble (precise-first targeting)", () => {
  const withStyles = { styles: STYLES } as unknown as EditedElement["selection"];
  function pick(
    file: string, componentName: string, tagName: string, line: number,
    ownerChain: { componentName: string; file: string; line: number; column: number }[] = [],
  ): EditedElement {
    return {
      selection: {
        ...withStyles, editId: line, file, line, column: 12,
        componentName, tagName, textEditable: false, ownerChain,
      } as EditedElement["selection"],
      pending: {},
    };
  }

  it("in-frame element → precise frames/<slug>/…:line:col", () => {
    const batch = [pick("/p/frames/home/index.tsx", "Button", "button", 40)];
    const out = buildTargetPreamble(batch, "home");
    expect(out).toContain("frames/home/index.tsx:40:12");
    expect(out).toContain("do NOT edit a different element that merely looks similar");
    expect(out).not.toContain("frames//");
  });

  it("kit element WITH an in-frame owner → points at the exact <Component/> usage (the bug)", () => {
    // The real failing case: clicked node resolves into kit source, but the owner
    // chain records the frame placement (ProjectsSidebar.tsx:76). We must address
    // THAT precise location, not send the agent hunting by description.
    const batch = [pick(
      "/p/prototype-kit/arcade-components.tsx", "IconButton", "button", 83,
      [
        { componentName: "IconButton", file: "/p/prototype-kit/arcade-components.tsx", line: 83, column: 4 },
        { componentName: "IconButton", file: "/p/projects/polina/frames/polina/ProjectsSidebar.tsx", line: 76, column: 12 },
      ],
    )];
    const out = buildTargetPreamble(batch, "polina");
    // Precise: names the in-frame placement, no fabricated frames// path, no kit line.
    expect(out).toContain("ProjectsSidebar.tsx:76:12");
    expect(out).not.toContain("frames//");
    expect(out).not.toContain("arcade-components.tsx:83");
    // Guards against the wrong-similar-element failure.
    expect(out).toContain("do NOT edit a different element that merely looks similar");
    // NOT routed to the vague baked/find-by-description path.
    expect(out).not.toContain("Identify the element by what it is and its visible content");
  });

  it("truly baked kit element (no in-frame owner) → find-by-description fallback, still no frames//", () => {
    const batch = [pick("/p/studio/prototype-kit/arcade-components.tsx", "IconButton", "button", 83)];
    const out = buildTargetPreamble(batch, "polina");
    expect(out).not.toContain("frames//");
    expect(out).not.toContain("arcade-components.tsx:83");
    expect(out).toContain("SHARED prototype-kit component");
    expect(out).toContain("frames/polina/index.tsx");
    expect(out).toContain("<IconButton>");
  });

  it("empty batch or missing slug → empty string", () => {
    expect(buildTargetPreamble([], "home")).toBe("");
    expect(buildTargetPreamble([pick("/p/frames/home/index.tsx", "X", "div", 1)], "")).toBe("");
  });
});
