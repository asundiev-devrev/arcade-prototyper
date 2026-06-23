/**
 * Public facade for the frame overlay. picker.ts calls only this module.
 * Composes the lifted design-mode overlay pieces (overlays / measureGuides)
 * into the hover/selection/clear API Studio's picker needs.
 *
 * layoutGuides.ts is present in the directory but parked for a later phase
 * (needs panel config for column-count/gutter/color that doesn't exist yet).
 *
 * Adapted from design-mode (MIT © 2026 Sandeep Baskaran). See THIRD-PARTY.md.
 */
import {
  showHover as paintHover, hideHover, showSelect, hideSelect,
  updateSelectPosition, destroyOverlays, resetOverlayTeardown, isOverlayElement as isOverlayNode,
} from "./overlays";
import {
  showAxisGuides, hideAxisGuides, showDistance, hideDistance, teardownMeasureGuides, resetMeasureTeardown,
} from "./measureGuides";
import { getElementRect } from "./geometry";

let selectedEl: HTMLElement | null = null;
let hoveredEl: HTMLElement | null = null;

export function setEnabled(on: boolean): void {
  if (on) {
    resetOverlayTeardown();
    resetMeasureTeardown();
  } else {
    clear();
    destroyOverlays();
    teardownMeasureGuides();
    selectedEl = null;
    hoveredEl = null;
  }
}

export function showHover(el: HTMLElement): void {
  hoveredEl = el;
  paintHover(el);
  showAxisGuides(getElementRect(el), "hover");
  if (selectedEl && selectedEl !== el) {
    showDistance(getElementRect(selectedEl), getElementRect(el));
  } else {
    hideDistance();
  }
}

export function showSelection(el: HTMLElement): void {
  selectedEl = el;
  showSelect(el);
  showAxisGuides(getElementRect(el), "select");
}

export function reposition(): void {
  if (hoveredEl) {
    paintHover(hoveredEl);
    showAxisGuides(getElementRect(hoveredEl), "hover");
    if (selectedEl && selectedEl !== hoveredEl) {
      showDistance(getElementRect(selectedEl), getElementRect(hoveredEl));
    } else {
      hideDistance();
    }
  }
  if (selectedEl) {
    updateSelectPosition(selectedEl);
  }
}

export function clear(): void {
  hideHover();
  hideSelect();
  hideAxisGuides();
  hideDistance();
  selectedEl = null;
  hoveredEl = null;
}

export function isOverlayElement(el: HTMLElement): boolean {
  return isOverlayNode(el);
}
