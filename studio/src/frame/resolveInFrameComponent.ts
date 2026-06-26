// studio/src/frame/resolveInFrameComponent.ts
export interface OwnerLink { componentName: string; file: string; line: number; column: number }
export interface InFrameComponent { componentName: string; file: string; line: number; column: number }

/**
 * Given the fiber owner chain (innermost → outermost) of a clicked element,
 * return the NEAREST (innermost) owner authored in the frame's own index.tsx —
 * the component instance closest to the click that the frame actually placed,
 * and the one whose props we can write. null when no owner is in-source.
 */
export function resolveInFrameComponent(chain: OwnerLink[], frameSlug: string): InFrameComponent | null {
  const needle = `/frames/${frameSlug}/`;
  for (const link of chain) {
    if (link.file.includes(needle)) {
      return { componentName: link.componentName, file: link.file, line: link.line, column: link.column };
    }
  }
  return null;
}
