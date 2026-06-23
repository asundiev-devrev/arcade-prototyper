/**
 * Measurement guides — axis lines + distance pills (design-mode lift, passive)
 *
 * Adapted from design-mode (https://github.com/SandeepBaskaran/design-mode),
 * MIT © 2026 Sandeep Baskaran. See THIRD-PARTY.md.
 *
 * This file lifts ONLY the passive guide/distance rendering. The interactive
 * resize handles, drag-to-move, and commit/preview handlers are intentionally
 * NOT ported — Phase 1 is passive observation only.
 */

import { Z_INDEX, type Rect } from './geometry';
import { OVERLAY_COLORS } from './overlayConfig';

const HOVER_COLOR = OVERLAY_COLORS.hover;
const SELECT_COLOR = OVERLAY_COLORS.select;
const MIN_GAP = 0.5;

let teardown = false;

let axisLayer: HTMLDivElement | null = null;
let distanceLayer: HTMLDivElement | null = null;

function ensureLayer(current: HTMLDivElement | null, id: string): HTMLDivElement {
  if (current && current.isConnected) return current;
  const layer = document.createElement('div');
  layer.id = id;
  Object.assign(layer.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none', zIndex: String(Z_INDEX.GUIDES) });
  document.documentElement.appendChild(layer);
  return layer;
}

function docWidth(): number {
  return Math.max(document.documentElement.scrollWidth, window.innerWidth);
}
function docHeight(): number {
  return Math.max(document.documentElement.scrollHeight, window.innerHeight);
}

// ── Axis guide lines (full-document dashed lines at an element's edges) ──

export function showAxisGuides(rect: Rect, variant: 'hover' | 'select') {
  if (teardown) return;
  axisLayer = ensureLayer(axisLayer, 'dm-axis-guides');
  axisLayer.replaceChildren();
  const color = variant === 'select' ? SELECT_COLOR : HOVER_COLOR;
  const w = docWidth();
  const h = docHeight();
  for (const y of [rect.top, rect.bottom]) addLine(axisLayer, 0, y, w, y, color, true);
  for (const x of [rect.left, rect.right]) addLine(axisLayer, x, 0, x, h, color, true);
}

export function hideAxisGuides() {
  axisLayer?.replaceChildren();
}

// ── Distance measurement between two rects ──

export interface DistanceLine { x1: number; y1: number; x2: number; y2: number; }
export interface DistancePill { x: number; y: number; label: string; }
export interface DistanceSegments { lines: DistanceLine[]; pills: DistancePill[]; }

// Edge-offset measurement: an axis-aligned connector (x1,y1)→(x2,y2) with a
// centered pill, plus a dashed extension projecting the target edge to the
// connector at (extX,extY).
function offset(lines: DistanceLine[], pills: DistancePill[], x1: number, y1: number, x2: number, y2: number, extX: number, extY: number) {
  const dist = Math.abs(x2 - x1) + Math.abs(y2 - y1);
  if (dist < MIN_GAP) return;
  lines.push({ x1, y1, x2, y2 });
  pills.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, label: String(Math.round(dist)) });
  if (Math.abs(extX - x2) + Math.abs(extY - y2) >= MIN_GAP) lines.push({ x1: x2, y1: y2, x2: extX, y2: extY });
}

// Pure geometry — no DOM. Returns axis-aligned connector lines + centered
// pills describing the gaps between rects `a` and `b` (viewport coords).
export function computeDistanceSegments(a: Rect, b: Rect): DistanceSegments {
  const lines: DistanceLine[] = [];
  const pills: DistancePill[] = [];
  const push = (x1: number, y1: number, x2: number, y2: number, val: number) => {
    if (Math.abs(val) < MIN_GAP) return;
    lines.push({ x1, y1, x2, y2 });
    pills.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, label: String(Math.round(Math.abs(val))) });
  };

  const aInB = b.left <= a.left && b.right >= a.right && b.top <= a.top && b.bottom >= a.bottom;
  const bInA = a.left <= b.left && a.right >= b.right && a.top <= b.top && a.bottom >= b.bottom;

  if (aInB || bInA) {
    const outer = bInA ? a : b;
    const inner = bInA ? b : a;
    const cx = (inner.left + inner.right) / 2;
    const cy = (inner.top + inner.bottom) / 2;
    push(outer.left, cy, inner.left, cy, inner.left - outer.left);
    push(inner.right, cy, outer.right, cy, outer.right - inner.right);
    push(cx, outer.top, cx, inner.top, inner.top - outer.top);
    push(cx, inner.bottom, cx, outer.bottom, outer.bottom - inner.bottom);
    return { lines, pills };
  }

  const overlapX = a.left < b.right && b.left < a.right;
  const overlapY = a.top < b.bottom && b.top < a.bottom;

  if (overlapX && !overlapY) {
    const [upper, lower] = a.bottom <= b.top ? [a, b] : [b, a];
    const x = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
    push(x, upper.bottom, x, lower.top, lower.top - upper.bottom);
    // Side offsets: how far a's vertical edges sit from b's, measured at a's
    // mid-height, with a dashed extension projecting b's edge to that line.
    const cy = (a.top + a.bottom) / 2;
    const bNearY = a.bottom <= b.top ? b.top : b.bottom;
    offset(lines, pills, a.left, cy, b.left, cy, b.left, bNearY);
    offset(lines, pills, a.right, cy, b.right, cy, b.right, bNearY);
    return { lines, pills };
  }

  if (overlapY && !overlapX) {
    const [leftR, rightR] = a.right <= b.left ? [a, b] : [b, a];
    const y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
    push(leftR.right, y, rightR.left, y, rightR.left - leftR.right);
    const cx = (a.left + a.right) / 2;
    const bNearX = a.right <= b.left ? b.left : b.right;
    offset(lines, pills, cx, a.top, cx, b.top, bNearX, b.top);
    offset(lines, pills, cx, a.bottom, cx, b.bottom, bNearX, b.bottom);
    return { lines, pills };
  }

  if (!overlapX && !overlapY) {
    // Diagonal — draw an L through the elbow facing the other box.
    const ax = a.right <= b.left ? a.right : a.left;
    const bx = a.right <= b.left ? b.left : b.right;
    const ay = a.bottom <= b.top ? a.bottom : a.top;
    const by = a.bottom <= b.top ? b.top : b.bottom;
    push(ax, ay, bx, ay, bx - ax);
    push(bx, ay, bx, by, by - ay);
    return { lines, pills };
  }

  // Partial overlap on both axes — show the four edge alignment offsets.
  const cx = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
  const cy = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
  push(a.left, cy, b.left, cy, b.left - a.left);
  push(a.right, cy, b.right, cy, b.right - a.right);
  push(cx, a.top, cx, b.top, b.top - a.top);
  push(cx, a.bottom, cx, b.bottom, b.bottom - a.bottom);
  return { lines, pills };
}

export function showDistance(base: Rect, target: Rect) {
  if (teardown) return;
  distanceLayer = ensureLayer(distanceLayer, 'dm-distance');
  distanceLayer.replaceChildren();
  paintSegments(distanceLayer, computeDistanceSegments(base, target));
}

export function hideDistance() {
  distanceLayer?.replaceChildren();
}

// ── Rendering helpers ──

function addLine(layer: HTMLDivElement, x1: number, y1: number, x2: number, y2: number, color: string, dashed: boolean) {
  const line = document.createElement('div');
  const style = dashed ? 'dashed' : 'solid';
  if (y1 === y2) {
    Object.assign(line.style, {
      position: 'fixed', top: y1 + 'px', left: Math.min(x1, x2) + 'px',
      width: Math.abs(x2 - x1) + 'px', height: '0',
      borderTop: `1px ${style} ${color}`, pointerEvents: 'none',
    });
  } else {
    Object.assign(line.style, {
      position: 'fixed', left: x1 + 'px', top: Math.min(y1, y2) + 'px',
      height: Math.abs(y2 - y1) + 'px', width: '0',
      borderLeft: `1px ${style} ${color}`, pointerEvents: 'none',
    });
  }
  layer.appendChild(line);
}

function addPill(layer: HTMLDivElement, x: number, y: number, label: string) {
  const pill = document.createElement('div');
  Object.assign(pill.style, {
    position: 'fixed', top: y + 'px', left: x + 'px',
    transform: 'translate(-50%, -50%)',
    background: SELECT_COLOR, color: '#fff',
    fontSize: '10px', fontFamily: 'monospace', fontWeight: '600',
    padding: '1px 6px', borderRadius: '9999px',
    pointerEvents: 'none', whiteSpace: 'nowrap', lineHeight: '1.4',
    zIndex: String(Z_INDEX.SELECT_OVERLAY + 1),
  });
  pill.textContent = label;
  layer.appendChild(pill);
}

function paintSegments(layer: HTMLDivElement, seg: DistanceSegments) {
  for (const l of seg.lines) addLine(layer, l.x1, l.y1, l.x2, l.y2, SELECT_COLOR, true);
  for (const p of seg.pills) addPill(layer, p.x, p.y, p.label);
}

// ── Teardown ──

export function teardownMeasureGuides() {
  teardown = true;
  [axisLayer, distanceLayer].forEach(l => l?.remove());
  axisLayer = distanceLayer = null;
}

export function resetMeasureTeardown() {
  teardown = false;
}
