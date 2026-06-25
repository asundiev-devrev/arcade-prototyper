const SPACE_STEPS: Record<number, string> = {
  0: "0", 2: "0.5", 4: "1", 6: "1.5", 8: "2", 10: "2.5", 12: "3", 14: "3.5",
  16: "4", 20: "5", 24: "6", 28: "7", 32: "8", 36: "9", 40: "10", 44: "11",
  48: "12", 56: "14", 64: "16", 80: "20", 96: "24",
};
const RADIUS_STEPS: Record<number, string> = {
  0: "none", 2: "sm", 4: "", 6: "md", 8: "lg", 12: "xl", 16: "2xl", 24: "3xl", 9999: "full",
};
const WEIGHTS: Record<string, string> = {
  "100": "font-thin", "200": "font-extralight", "300": "font-light",
  "400": "font-normal", "500": "font-medium", "600": "font-semibold",
  "700": "font-bold", "800": "font-extrabold", "900": "font-black",
};
const SIDE_PREFIX: Record<string, string> = {
  paddingTop: "pt", paddingRight: "pr", paddingBottom: "pb", paddingLeft: "pl",
  marginTop: "mt", marginRight: "mr", marginBottom: "mb", marginLeft: "ml",
  gap: "gap",
};
export const SPACE_FIELDS: ReadonlySet<string> = new Set(Object.keys(SIDE_PREFIX));

function px(value: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

export function pxToSpace(n: number): string | null {
  return Object.prototype.hasOwnProperty.call(SPACE_STEPS, n) ? SPACE_STEPS[n] : null;
}
export function pxToRadius(n: number): string | null {
  return Object.prototype.hasOwnProperty.call(RADIUS_STEPS, n) ? RADIUS_STEPS[n] : null;
}

export function translateField(field: string, value: string): string | null {
  if (SPACE_FIELDS.has(field)) {
    const n = px(value);
    if (n === null) return null;
    const step = pxToSpace(n);
    return step === null ? null : `${SIDE_PREFIX[field]}-${step}`;
  }
  if (field === "borderRadius") {
    const n = px(value);
    if (n === null) return null;
    const r = pxToRadius(n);
    if (r === null) return null;
    return r === "" ? "rounded" : `rounded-${r}`;
  }
  if (field === "fontWeight") return WEIGHTS[value.trim()] ?? null;
  if (field === "textAlign") {
    return ["left", "center", "right", "justify"].includes(value.trim())
      ? `text-${value.trim()}` : null;
  }
  if (field === "fontStyle") {
    if (value.trim() === "italic") return "italic";
    if (value.trim() === "normal") return "not-italic";
    return null;
  }
  if (field === "opacity") {
    const f = Number(value);
    if (!Number.isFinite(f)) return null;
    const pct = Math.round(f * 100);
    return pct % 5 === 0 && pct >= 0 && pct <= 100 ? `opacity-${pct}` : null;
  }
  // fontSize, width, height, minWidth, maxWidth, minHeight, maxHeight, display,
  // flexDirection → bail to AI in Phase A.
  return null;
}
