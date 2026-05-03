// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi } from "vitest";

// Mock @xorkavi/arcade-gen to avoid gridstack ESM resolution issues.
// We provide minimal forwardRef Button/IconButton mocks that pass props through.
vi.mock("@xorkavi/arcade-gen", () => {
  const React = require("react");
  return {
    Button: React.forwardRef<HTMLButtonElement, any>((props, ref) => {
      return React.createElement("button", { ...props, ref });
    }),
    IconButton: React.forwardRef<HTMLButtonElement, any>((props, ref) => {
      return React.createElement("button", { ...props, ref });
    }),
  };
});

import {
  Button,
  IconButton,
} from "../../prototype-kit/arcade-components";

/**
 * The shim wraps @xorkavi/arcade-gen's Button/IconButton in a forwardRef
 * component that:
 *  1) Narrows the TypeScript `size` prop to "md" | "lg" (checked via
 *     `@ts-expect-error` below — these lines MUST be type errors).
 *  2) Coerces runtime `size="sm"` → `size="md"` before delegating to the
 *     real component.
 *
 * We invoke the wrapper's forwardRef render function and inspect the
 * returned element's props. We do NOT import the raw Button/IconButton
 * from @xorkavi/arcade-gen here — pulling that module into this test
 * file tickles a gridstack ESM resolution bug in vitest. The identity
 * check ("does out.type delegate somewhere") is handled indirectly: a
 * successful forwardRef unwrap + correct props on the inner element is
 * sufficient evidence that delegation works.
 */

const FORWARD_REF = Symbol.for("react.forward_ref");

function assertIsForwardRef(component: unknown): asserts component is { render: (props: any, ref: any) => React.ReactElement } {
  // Before Task 4 narrows the shim, `Button`/`IconButton` are the raw
  // arcade-gen exports re-exported via `export *`. Those ARE forwardRef
  // components too, so this assertion passes even in the red state — the
  // *runtime coercion* assertions below are what fail in the red state.
  const c = component as any;
  if (c?.$$typeof !== FORWARD_REF || typeof c.render !== "function") {
    throw new Error("Expected a forwardRef component (shim must wrap the raw component)");
  }
}

function renderOnce(element: React.ReactElement): React.ReactElement {
  const type = element.type as any;
  assertIsForwardRef(type);
  return type.render(element.props, null);
}

describe("arcade-components shim — Button", () => {
  it("passes size=\"md\" through to the inner component", () => {
    const out = renderOnce(<Button size="md">Save</Button>);
    expect(out.props.size).toBe("md");
    expect(out.props.children).toBe("Save");
  });

  it("passes size=\"lg\" through to the inner component", () => {
    const out = renderOnce(<Button size="lg">Save</Button>);
    expect(out.props.size).toBe("lg");
  });

  it("passes undefined size through (uses inner default)", () => {
    const out = renderOnce(<Button>Save</Button>);
    expect(out.props.size).toBeUndefined();
  });

  it("coerces runtime size=\"sm\" to \"md\" before delegating", () => {
    // Cast forces the runtime value through despite the type narrowing —
    // simulates a dynamic prop or a JS caller bypassing the types.
    const out = renderOnce(
      <Button size={"sm" as "md"}>Save</Button>,
    );
    expect(out.props.size).toBe("md");
  });

  it("preserves other props when coercing (variant, onClick, children)", () => {
    const onClick = () => {};
    const out = renderOnce(
      <Button
        size={"sm" as "md"}
        variant="primary"
        onClick={onClick}
      >
        Save
      </Button>,
    );
    expect(out.props.size).toBe("md");
    expect(out.props.variant).toBe("primary");
    expect(out.props.onClick).toBe(onClick);
    expect(out.props.children).toBe("Save");
  });
});

describe("arcade-components shim — IconButton", () => {
  it("passes size=\"md\" through to the inner component", () => {
    const out = renderOnce(
      <IconButton size="md" aria-label="Close">×</IconButton>,
    );
    expect(out.props.size).toBe("md");
    expect(out.props["aria-label"]).toBe("Close");
  });

  it("passes size=\"lg\" through to the inner component", () => {
    const out = renderOnce(
      <IconButton size="lg" aria-label="Close">×</IconButton>,
    );
    expect(out.props.size).toBe("lg");
  });

  it("coerces runtime size=\"sm\" to \"md\" before delegating", () => {
    const out = renderOnce(
      <IconButton size={"sm" as "md"} aria-label="Close">×</IconButton>,
    );
    expect(out.props.size).toBe("md");
  });
});

describe("arcade-components shim — type narrowing", () => {
  it("rejects size=\"sm\" at the type level", () => {
    // These are expected TYPE errors after Task 4. Before Task 4, the
    // shim re-exports the raw arcade-gen types which accept "sm", so the
    // `@ts-expect-error` directives will be flagged as unused during the
    // red phase. That's part of the TDD cycle — Task 4 makes them real
    // type errors, satisfying the directive.
    //
    // The runtime expect below is cosmetic; the real assertion is the
    // presence of the @ts-expect-error directives.
    // @ts-expect-error — size="sm" is intentionally unreachable via the shim
    const b1 = <Button size="sm">x</Button>;
    // @ts-expect-error — size="sm" is intentionally unreachable via the shim
    const b2 = <IconButton size="sm" aria-label="x">×</IconButton>;
    expect(b1).toBeTruthy();
    expect(b2).toBeTruthy();
  });
});
