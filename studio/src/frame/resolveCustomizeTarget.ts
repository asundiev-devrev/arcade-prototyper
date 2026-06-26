export interface OwnerLink { componentName: string; file: string; line: number; column: number }
export interface CustomizeTarget { componentName: string; line: number; column: number }

/**
 * Given the fiber owner chain (innermost → outermost) of a clicked element,
 * return the OUTERMOST owner authored in the frame's own index.tsx — that is the
 * component instance the designer/generator actually placed in the frame, and
 * the only one that can be spliced/replaced in the frame source. null when no
 * owner is in-source (element comes entirely from shared component code with no
 * in-frame anchor — should not happen for a rendered frame, but guard anyway).
 */
export function resolveCustomizeTarget(chain: OwnerLink[], frameSlug: string): CustomizeTarget | null {
  const needle = `/frames/${frameSlug}/`;
  let target: CustomizeTarget | null = null;
  for (const link of chain) {
    if (link.file.includes(needle)) {
      // keep overwriting → ends on the outermost in-source link
      target = { componentName: link.componentName, line: link.line, column: link.column };
    }
  }
  return target;
}
