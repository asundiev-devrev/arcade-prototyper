/**
 * Public facade for the frame overlay. picker.ts calls only this module.
 * Composes the lifted design-mode overlay pieces (overlays / measureGuides /
 * layoutGuides) into the hover/selection/clear API Studio's picker needs.
 *
 * Adapted from design-mode (MIT © 2026 Sandeep Baskaran). See THIRD-PARTY.md.
 */
import {
  showHover as paintHover, hideHover, showSelect, hideSelect,
  updateSelectPosition, destroyOverlays, resetOverlayTeardown, isOverlayElement as isOverlayNode,
} from "./overlays";
import {
  showAxisGuides, hideAxisGuides, teardownMeasureGuides, resetMeasureTeardown,
} from "./measureGuides";
import { getElementRect } from "./geometry";

let selectedEl: HTMLElement | null = null;

export function setEnabled(on: boolean): void {
  if (on) {
    resetOverlayTeardown();
    resetMeasureTeardown();
  } else {
    clear();
    destroyOverlays();
    teardownMeasureGuides();
    selectedEl = null;
  }
}

export function showHover(el: HTMLElement): void {
  paintHover(el);
  showAxisGuides(getElementRect(el), "hover");
}

export function showSelection(el: HTMLElement): void {
  selectedEl = el;
  showSelect(el);
  showAxisGuides(getElementRect(el), "select");
}

export function reposition(el: HTMLElement | null): void {
  const target = el ?? selectedEl;
  if (!target) return;
  updateSelectPosition(target);
}

export function clear(): void {
  hideHover();
  hideSelect();
  hideAxisGuides();
  selectedEl = null;
}

export function isOverlayElement(el: HTMLElement): boolean {
  return isOverlayNode(el);
}
