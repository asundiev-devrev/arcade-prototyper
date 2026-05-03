// studio/prototype-kit/arcade-components.tsx
//
// Generator-facing surface for `arcade` / `arcade/components`. Re-exports
// @xorkavi/arcade-gen verbatim, except Button and IconButton are narrowed
// to size "md" | "lg" — sm is intentionally unreachable from agent-authored
// frame code. Studio shell and prototype-kit composites import the real
// arcade-gen package directly and keep full access.
//
// Why: at sm both controls render at 20px with zero vertical padding and
// 11px text, which does not match the Figma design system (Default 28px,
// Large 40px). Historically the generator has picked sm frequently, which
// produces "squished" top bars and buttons that read as inline links.
//
// Belt-and-suspenders: the wrappers also coerce a runtime size="sm" to
// "md" before delegating, so a dynamic prop or a JS caller that bypasses
// the TypeScript narrowing still renders correctly.

import * as React from "react";
import {
  Button as RawButton,
  IconButton as RawIconButton,
  type ButtonProps as RawButtonProps,
  type IconButtonProps as RawIconButtonProps,
} from "@xorkavi/arcade-gen";

export * from "@xorkavi/arcade-gen";

type NarrowSize = "md" | "lg";

export type ButtonProps = Omit<RawButtonProps, "size"> & { size?: NarrowSize };
export type IconButtonProps = Omit<RawIconButtonProps, "size"> & { size?: NarrowSize };

function coerceSize<T extends { size?: string }>(props: T): T {
  return props.size === "sm" ? { ...props, size: "md" } : props;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(props, ref) {
    return <RawButton ref={ref} {...(coerceSize(props) as RawButtonProps)} />;
  },
);

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    return <RawIconButton ref={ref} {...(coerceSize(props) as RawIconButtonProps)} />;
  },
);
