export const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0,
] as const;

export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export function nextStep(current: number, dir: "in" | "out"): number {
  if (dir === "in") {
    const above = ZOOM_STEPS.find((s) => s > current + 1e-6);
    return above ?? ZOOM_MAX;
  }
  // dir === "out"
  let below = ZOOM_MIN;
  for (const s of ZOOM_STEPS) {
    if (s < current - 1e-6) below = s;
    else break;
  }
  return below;
}

export function snapToNearestStep(raw: number): number {
  if (raw <= ZOOM_MIN) return ZOOM_MIN;
  if (raw >= ZOOM_MAX) return ZOOM_MAX;
  let best = ZOOM_STEPS[0];
  let bestDist = Math.abs(raw - best);
  for (const s of ZOOM_STEPS) {
    const d = Math.abs(raw - s);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

export function formatZoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
