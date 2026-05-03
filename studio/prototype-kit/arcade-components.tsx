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
//
// IconButton also constrains the inner icon size. Arcade-gen's IconButton
// variants size the button but not the icon inside, and DevRev icon
// components default to size=24, so a plain <ChevronLeftSmall/> renders
// 24×24 inside a 28×28 button — the icon visually fills the box.
//
// The wrapper clones the single child icon element and injects an explicit
// `size` prop (16px for md, 20px for lg, matching Figma). DevRev icon
// components set the svg's `width`/`height` attributes from this prop, so
// the result works regardless of Tailwind class compilation or SVG
// attribute/CSS precedence quirks.

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

// Pixel size the child icon should render at, per IconButton size variant.
const ICON_PIXEL_SIZE_BY_SIZE: Record<NarrowSize, number> = {
  md: 16,
  lg: 20,
};

// If the child is a single DevRev icon element that accepts a numeric
// `size` prop, clone it with the correct pixel size for this button.
// If the child is anything else (multiple elements, a string, a custom
// wrapper), leave it alone — no safe way to pass size down generically.
function sizeIconChild(children: React.ReactNode, pixelSize: number): React.ReactNode {
  if (!React.isValidElement(children)) return children;
  const childProps = children.props as { size?: unknown };
  // Only override when size is absent or numeric (DevRev icon contract).
  // String-sized children or explicit numeric overrides by the caller are
  // left alone — respect caller intent.
  if (typeof childProps.size === "string") return children;
  if (typeof childProps.size === "number") return children;
  return React.cloneElement(children as React.ReactElement<{ size?: number }>, { size: pixelSize });
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(props, ref) {
    return <RawButton ref={ref} {...(coerceSize(props) as RawButtonProps)} />;
  },
);

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    const coerced = coerceSize(props) as RawIconButtonProps;
    const size = (coerced.size ?? "md") as NarrowSize;
    const pixelSize = ICON_PIXEL_SIZE_BY_SIZE[size];
    const children = sizeIconChild(coerced.children, pixelSize);
    return <RawIconButton ref={ref} {...coerced} children={children} />;
  },
);
