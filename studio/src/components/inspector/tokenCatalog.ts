// Curated arcade design-system token catalogs for the inspector's token-first
// controls. Color NAMES are a curated list of the stable arcade vocabulary
// (fg/bg/stroke/surface; --component-* excluded as those are internal recipes).
// Swatches resolve LIVE (resolveSwatch) because the tokens are var() chains.

export interface ColorToken { token: string; label: string; }
export type ColorSlot = "color" | "backgroundColor" | "borderColor";

// Curated set — the user-facing color choices. Grouped by family for the label.
const COLOR_TOKEN_NAMES: string[] = [
  // foreground (text)
  "--fg-neutral-prominent", "--fg-neutral-medium", "--fg-neutral-subtle",
  "--fg-success-prominent", "--fg-warning-prominent", "--fg-alert-prominent",
  "--fg-info-prominent", "--fg-critical-prominent",
  // background / surface (fill)
  "--bg-neutral-soft", "--bg-neutral-medium", "--bg-neutral-prominent", "--bg-neutral-subtle",
  "--bg-success-subtle", "--bg-success-medium",
  "--bg-warning-subtle", "--bg-warning-medium",
  "--bg-alert-subtle", "--bg-alert-medium",
  "--bg-info-subtle", "--bg-info-medium",
  "--bg-expressive-blue-medium", "--bg-expressive-yellow-medium",
  "--surface-canvas", "--surface-overlay",
  // stroke (border)
  "--stroke-neutral-subtle", "--stroke-neutral-medium",
];

function humanize(token: string): string {
  // "--fg-neutral-prominent" -> "Neutral prominent" (drop the family prefix)
  const body = token.replace(/^--(fg|bg|stroke|surface)-/, "");
  const words = body.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function colorTokens(): ColorToken[] {
  return COLOR_TOKEN_NAMES.map((token) => ({ token, label: humanize(token) }));
}

const TYPE_TOKENS: { className: string; label: string }[] = [
  { className: "text-body", label: "Body" },
  { className: "text-body-medium", label: "Body medium" },
  { className: "text-body-small", label: "Body small" },
  { className: "text-body-bold", label: "Body bold" },
  { className: "text-body-large-bold", label: "Body large bold" },
  { className: "text-title-large", label: "Title large" },
];

export function typeTokens(): { className: string; label: string }[] {
  return TYPE_TOKENS;
}

const SLOT_PREFIX: Record<ColorSlot, string> = {
  color: "text",
  backgroundColor: "bg",
  borderColor: "border",
};

export function colorClassName(token: string, slot: ColorSlot): string {
  return `${SLOT_PREFIX[slot]}-(${token})`;
}

export function colorTokenFromClass(cls: string): { token: string; slot: ColorSlot } | null {
  const m = /^(text|bg|border)-\((--[a-z0-9-]+)\)$/.exec(cls.trim());
  if (!m) return null;
  const slot: ColorSlot = m[1] === "text" ? "color" : m[1] === "bg" ? "backgroundColor" : "borderColor";
  return { token: m[2], slot };
}

/** Live computed value of a custom property, for the swatch chip. rootEl is the
 *  element whose getComputedStyle resolves the var() chain (the frame root). */
export function resolveSwatch(token: string, rootEl: Element): string {
  try {
    return getComputedStyle(rootEl).getPropertyValue(token).trim() || "transparent";
  } catch {
    return "transparent";
  }
}
