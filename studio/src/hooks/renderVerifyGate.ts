/** Pure gate for render-verify v3. Fires only on an EDIT turn that claimed a
 *  change, once per turn. Bias to NOT firing (a missed verify is fine; a wasted
 *  corrective is the cost we avoid). */
export function shouldRunRenderVerify(input: {
  phase: "done" | "error" | "cancelled" | string;
  isEditTurn: boolean;
  summaryClaimsChange: boolean;
  alreadyRan: boolean;
}): boolean {
  return input.phase === "done" && input.isEditTurn && input.summaryClaimsChange && !input.alreadyRan;
}
