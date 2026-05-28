/**
 * Static map of composite name → skeleton shape for the live cursor's
 * pre-paint scaffold. Keys must match the component identifiers users
 * import from `@xorkavi/arcade-gen` or the local `prototype-kit/composites/`.
 *
 * Adding a new composite to prototype-kit? Add an entry here too. Missing
 * entries are silently ignored (caller falls back to a generic block).
 */
export type SkeletonShape =
  | { kind: "block"; height: string }
  | { kind: "bar"; height: string; anchor: "top" | "bottom" }
  | { kind: "rail"; width: string; anchor: "left" | "right" }
  | { kind: "tile"; aspect: string; repeat: number }
  | { kind: "centered"; width: string; height: string };

export const SHAPES: Readonly<Record<string, SkeletonShape>> = {
  Hero: { kind: "block", height: "30%" },
  Header: { kind: "bar", height: "8%", anchor: "top" },
  Footer: { kind: "bar", height: "8%", anchor: "bottom" },
  Sidebar: { kind: "rail", width: "20%", anchor: "left" },
  Card: { kind: "tile", aspect: "4/3", repeat: 3 },
  Modal: { kind: "centered", width: "60%", height: "50%" },
};

export type Shape = (typeof SHAPES)[keyof typeof SHAPES];
